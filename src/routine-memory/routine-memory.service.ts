import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  ApplicationItemStatus,
  type ApplicationItemProductSnapshot,
} from '../application-tracking/application-tracking.constants';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { CataloguePhotoStorageService } from '../catalogue/catalogue-photo-storage.service';
import { resolveEffectiveTimeZone } from '../common/timezone/timezone.utils';
import { toDateOnlyString, toIsoString } from '../common/utils/date';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../shelf/shelf.types';
import { formatDateInTimeZone } from '../suggestions/services/suggestion-helpers';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import {
  type RecentChangeKind,
  type ReactionReportPayload,
} from '../skin-journal/skin-journal.constants';
import { User } from '../users/entities/user.entity';
import {
  RoutineMemoryProductDto,
  RoutineMemoryProductTimelineDto,
  RoutineMemoryResponseDto,
  RoutineMemorySuspiciousProductDto,
  RoutineMemoryTimelineEventDto,
} from './dto/routine-memory-response.dto';
import {
  RoutineMemoryEventSeverityValue,
  RoutineMemoryEventTypeValue,
  RoutineMemoryReasonCodeValue,
  RoutineMemorySourceTypeValue,
  RoutineMemorySuspicionLevelValue,
  type RoutineMemoryEventSeverity,
  type RoutineMemoryEventType,
  type RoutineMemoryReasonCode,
  type RoutineMemorySuspicionLevel,
} from './routine-memory.types';

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;
const REACTION_LINK_DAYS = 7;
const PRODUCT_ADDED_LINK_DAYS = 14;

const ACTIVE_CATEGORIES = new Set<string>([
  ProductCategory.Exfoliant,
  ProductCategory.Treatment,
]);

type RoutineMemoryQuery = {
  from?: string;
  to?: string;
};

type ProductMemory = {
  product: RoutineMemoryProductDto;
  addedDate: string | null;
  firstUseDate: string | null;
  firstUseEventEmitted: boolean;
  lastUseDate: string | null;
  frequencyChangeDates: string[];
  skippedDates: string[];
};

type LifetimeProductUsageRow = {
  productId: string;
  firstUseDate: string | Date;
  lastUseDate: string | Date;
};

type ResolveProductImageUrl = (
  product: InventoryProduct | null | undefined,
) => string | null;

@Injectable()
export class RoutineMemoryService {
  constructor(
    @InjectRepository(ApplicationLog)
    private readonly applications: Repository<ApplicationLog>,
    @InjectRepository(SkinJournalEntry)
    private readonly entries: Repository<SkinJournalEntry>,
    @InjectRepository(InventoryProduct)
    private readonly inventoryProducts: Repository<InventoryProduct>,
    @InjectRepository(RoutineSimplificationEvent)
    private readonly simplifications: Repository<RoutineSimplificationEvent>,
    private readonly cataloguePhotoStorageService: CataloguePhotoStorageService,
  ) {}

  async getTimeline(
    user: User,
    query: RoutineMemoryQuery = {},
    now = new Date(),
    requestTimeZone?: string | null,
  ): Promise<RoutineMemoryResponseDto> {
    const timeZone = resolveEffectiveTimeZone(user.time_zone, requestTimeZone);
    const window = resolveWindow(query, now, timeZone);
    const startDate = dateOnlyToUtc(window.start);
    const endDate = endOfDateOnlyUtc(window.end);

    const products = await this.inventoryProducts.find({
      select: {
        id: true,
        brand: true,
        name: true,
        category: true,
        created_at: true,
        identity: true,
      },
      where: {
        user_id: user.id,
        status: ShelfStatus.Active,
      },
      order: { created_at: 'ASC' },
    });
    const productIds = products.map((product) => product.id);

    const [lifetimeUsageRows, logs, journalEntries, recoveryEvents] =
      await Promise.all([
        this.loadLifetimeProductUsage(user.id, productIds),
        this.applications.find({
          select: {
            id: true,
            target_date: true,
            applied_at: true,
            updated_at: true,
            items: {
              id: true,
              step_order: true,
              inventory_product_id: true,
              substituted_with_product_id: true,
              product_brand_snapshot: true,
              product_name_snapshot: true,
              step_label: true,
              status: true,
              ad_hoc_brand: true,
              ad_hoc_name: true,
              applied_at: true,
              recommended_snapshot: true,
              applied_snapshot: true,
              product: {
                id: true,
                brand: true,
                name: true,
                category: true,
                identity: true,
              },
              substituted_with_product: {
                id: true,
                brand: true,
                name: true,
                category: true,
                identity: true,
              },
            },
          },
          where: {
            user_id: user.id,
            target_date: Between(window.start, window.end),
          },
          relations: [
            'items',
            'items.product',
            'items.substituted_with_product',
          ],
          order: { target_date: 'ASC' },
        }),
        this.entries.find({
          select: {
            id: true,
            entry_date: true,
            created_at: true,
            recent_change: true,
            reaction_report: true,
            ratings: true,
            analysis_observations: true,
            has_reaction_signal: true,
          },
          where: {
            user_id: user.id,
            entry_date: Between(window.start, window.end),
          },
          order: { entry_date: 'ASC' },
        }),
        this.simplifications.find({
          select: {
            id: true,
            started_at: true,
          },
          where: {
            user_id: user.id,
            started_at: Between(startDate, endDate),
          },
          order: { started_at: 'ASC' },
        }),
      ]);

    const resolveProductImageUrl = createProductImageUrlResolver(
      this.cataloguePhotoStorageService,
    );
    const productById = new Map(
      products.map((product) => [
        product.id,
        productReference(product, resolveProductImageUrl),
      ]),
    );
    const memoryByProduct = new Map<string, ProductMemory>();
    const timeline: RoutineMemoryTimelineEventDto[] = [];
    const reactionDates: string[] = [];

    for (const product of products) {
      const productRef =
        productById.get(product.id) ??
        productReference(product, resolveProductImageUrl);
      const productAddedDate = toDateOnlyString(product.created_at);
      if (productRef.productId) {
        ensureMemory(memoryByProduct, productRef).addedDate = productAddedDate;
      }
      if (!isDateInWindow(productAddedDate, window.start, window.end)) continue;
      timeline.push(
        event({
          id: `product-added:${product.id}`,
          date: productAddedDate,
          occurredAt: toIsoString(product.created_at),
          type: RoutineMemoryEventTypeValue.ProductAdded,
          severity: RoutineMemoryEventSeverityValue.Info,
          product: productRef,
          sourceType: RoutineMemorySourceTypeValue.InventoryProduct,
          sourceId: product.id,
        }),
      );
    }

    applyLifetimeUsage(memoryByProduct, productById, lifetimeUsageRows);

    for (const log of logs) {
      for (const item of sortedItems(log.items ?? [])) {
        const product = productReferenceFromItem(item, resolveProductImageUrl);
        if (item.status === ApplicationItemStatus.Skipped) {
          if (product?.productId) {
            ensureMemory(memoryByProduct, product).skippedDates.push(
              toDateOnlyString(log.target_date),
            );
          }
          timeline.push(
            event({
              id: `product-skipped:${log.id}:${item.id}`,
              date: toDateOnlyString(log.target_date),
              occurredAt: toNullableIso(log.applied_at ?? log.updated_at),
              type: RoutineMemoryEventTypeValue.ProductSkipped,
              severity: RoutineMemoryEventSeverityValue.Watch,
              product,
              sourceType: RoutineMemorySourceTypeValue.ApplicationLog,
              sourceId: log.id,
            }),
          );
          continue;
        }

        if (!product?.productId) continue;
        const memory = ensureMemory(memoryByProduct, product);
        const useDate = toDateOnlyString(log.target_date);
        if (!memory.firstUseDate || useDate < memory.firstUseDate) {
          memory.firstUseDate = useDate;
        }
        if (memory.firstUseDate === useDate && !memory.firstUseEventEmitted) {
          memory.firstUseEventEmitted = true;
          timeline.push(
            event({
              id: `first-use:${log.id}:${item.id}`,
              date: useDate,
              occurredAt: toNullableIso(item.applied_at ?? log.applied_at),
              type: RoutineMemoryEventTypeValue.FirstLoggedUse,
              severity: RoutineMemoryEventSeverityValue.Info,
              product,
              sourceType: RoutineMemorySourceTypeValue.ApplicationLog,
              sourceId: log.id,
            }),
          );
        } else {
          timeline.push(
            event({
              id: `product-used:${log.id}:${item.id}`,
              date: useDate,
              occurredAt: toNullableIso(item.applied_at ?? log.applied_at),
              type: RoutineMemoryEventTypeValue.ProductUsed,
              severity: RoutineMemoryEventSeverityValue.Info,
              product,
              sourceType: RoutineMemorySourceTypeValue.ApplicationLog,
              sourceId: log.id,
            }),
          );
        }
        if (!memory.lastUseDate || memory.lastUseDate < useDate) {
          memory.lastUseDate = useDate;
        }
      }
    }

    for (const entry of journalEntries) {
      if (entry.recent_change) {
        const product = entry.recent_change.related_inventory_product_id
          ? (productById.get(
              entry.recent_change.related_inventory_product_id,
            ) ?? null)
          : null;
        const type = eventTypeForRecentChange(entry.recent_change.kind);
        if (type === RoutineMemoryEventTypeValue.FrequencyChanged && product) {
          ensureMemory(memoryByProduct, product).frequencyChangeDates.push(
            entry.entry_date,
          );
        }
        timeline.push(
          event({
            id: `recent-change:${entry.id}`,
            date: entry.entry_date,
            occurredAt: toIsoString(entry.created_at),
            type,
            severity: RoutineMemoryEventSeverityValue.Watch,
            product,
            sourceType: RoutineMemorySourceTypeValue.SkinJournalEntry,
            sourceId: entry.id,
          }),
        );
      }

      if (hasReactionSignal(entry)) {
        reactionDates.push(entry.entry_date);
        timeline.push(
          event({
            id: `reaction-signal:${entry.id}`,
            date: entry.entry_date,
            occurredAt: toIsoString(entry.created_at),
            type: RoutineMemoryEventTypeValue.ReactionSignal,
            severity: reactionSeverity(entry.reaction_report),
            product: null,
            sourceType: RoutineMemorySourceTypeValue.SkinJournalEntry,
            sourceId: entry.id,
          }),
        );
      }
    }

    for (const recoveryEvent of recoveryEvents) {
      timeline.push(
        event({
          id: `recovery-started:${recoveryEvent.id}`,
          date: toDateOnlyString(recoveryEvent.started_at),
          occurredAt: toIsoString(recoveryEvent.started_at),
          type: RoutineMemoryEventTypeValue.RecoveryStarted,
          severity: RoutineMemoryEventSeverityValue.Recovery,
          product: null,
          sourceType: RoutineMemorySourceTypeValue.RoutineSimplification,
          sourceId: recoveryEvent.id,
        }),
      );
    }

    const sortedTimeline = timeline.sort(compareEvents);
    const suspiciousProducts = buildSuspiciousProducts(
      memoryByProduct,
      reactionDates,
    );
    const productTimelines = buildProductTimelines(
      memoryByProduct,
      sortedTimeline,
      suspiciousProducts,
    );

    return {
      generatedAt: toIsoString(now),
      timeZone,
      window,
      disclaimer:
        'Routine Memory shows timing patterns, not proof of what caused a reaction.',
      summary: {
        timelineEventCount: sortedTimeline.length,
        productChangeCount: sortedTimeline.filter(isProductChangeEvent).length,
        applicationLogCount: logs.length,
        reactionSignalCount: reactionDates.length,
        recoveryEventCount: recoveryEvents.length,
        suspiciousProductCount: suspiciousProducts.length,
        hasPossibleLinks: suspiciousProducts.length > 0,
      },
      timeline: sortedTimeline,
      suspiciousProducts,
      productTimelines,
    };
  }

  private async loadLifetimeProductUsage(
    userId: string,
    productIds: string[],
  ): Promise<LifetimeProductUsageRow[]> {
    if (productIds.length === 0) return [];

    const productIdExpression =
      'COALESCE(item.substituted_with_product_id, item.inventory_product_id)';

    return this.applications
      .createQueryBuilder('log')
      .innerJoin('log.items', 'item')
      .select(productIdExpression, 'productId')
      .addSelect('MIN(log.target_date)', 'firstUseDate')
      .addSelect('MAX(log.target_date)', 'lastUseDate')
      .where('log.user_id = :userId', { userId })
      .andWhere(
        `(
          (item.status = :appliedStatus AND item.inventory_product_id IN (:...productIds))
          OR
          (item.status = :substitutedStatus AND item.substituted_with_product_id IN (:...productIds))
        )`,
        {
          appliedStatus: ApplicationItemStatus.Applied,
          substitutedStatus: ApplicationItemStatus.Substituted,
          productIds,
        },
      )
      .groupBy(productIdExpression)
      .getRawMany<LifetimeProductUsageRow>();
  }
}

function createProductImageUrlResolver(
  cataloguePhotoStorageService: CataloguePhotoStorageService,
): ResolveProductImageUrl {
  const resolvedByProductId = new Map<string, string | null>();

  return (product) => {
    if (!product) return null;
    const cached = resolvedByProductId.get(product.id);
    if (cached !== undefined) return cached;

    const imageUrls = product.identity?.imageUrls ?? [];
    const imageUrl =
      imageUrls.length > 0
        ? (cataloguePhotoStorageService.resolvePublicImageUrls(imageUrls)[0] ??
          null)
        : null;
    resolvedByProductId.set(product.id, imageUrl);
    return imageUrl;
  };
}
function resolveWindow(
  query: RoutineMemoryQuery,
  now: Date,
  timeZone: string,
): { start: string; end: string; days: number } {
  const end = query.to
    ? validateDateOnly(query.to, 'to')
    : formatDateInTimeZone(timeZone, now);
  const start = query.from
    ? validateDateOnly(query.from, 'from')
    : addDaysToDateOnly(end, -(DEFAULT_WINDOW_DAYS - 1));
  const days = daysBetween(start, end) + 1;
  if (days < 1) {
    throw new BadRequestException('from must be before or equal to to.');
  }
  if (days > MAX_WINDOW_DAYS) {
    throw new BadRequestException(
      `Routine memory window cannot exceed ${MAX_WINDOW_DAYS} days.`,
    );
  }
  return { start, end, days };
}

function validateDateOnly(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${name} must be a YYYY-MM-DD date.`);
  }
  return value;
}

function event(
  input: RoutineMemoryTimelineEventDto,
): RoutineMemoryTimelineEventDto {
  return input;
}

function productReference(
  product: InventoryProduct,
  resolveProductImageUrl: ResolveProductImageUrl,
): RoutineMemoryProductDto {
  return {
    productId: product.id,
    brand: product.brand,
    name: product.name,
    category: product.category,
    imageUrl: resolveProductImageUrl(product),
  };
}

function productReferenceFromItem(
  item: ApplicationLogItem,
  resolveProductImageUrl: ResolveProductImageUrl,
): RoutineMemoryProductDto | null {
  const snapshot = resolveItemSnapshot(item);
  const sourceProduct =
    item.status === ApplicationItemStatus.Substituted
      ? item.substituted_with_product
      : item.product;
  const productId =
    snapshot?.product_id ??
    (item.status === ApplicationItemStatus.Substituted
      ? item.substituted_with_product_id
      : item.inventory_product_id) ??
    sourceProduct?.id ??
    null;
  const brand =
    snapshot?.brand ??
    sourceProduct?.brand ??
    item.product_brand_snapshot ??
    item.ad_hoc_brand ??
    null;
  const name =
    snapshot?.name ??
    sourceProduct?.name ??
    item.product_name_snapshot ??
    item.ad_hoc_name ??
    null;
  const category =
    sourceProduct?.category ?? snapshot?.step_label ?? item.step_label ?? null;
  if (!productId && !brand && !name) return null;
  return {
    productId,
    brand,
    name,
    category,
    imageUrl: resolveProductImageUrl(sourceProduct),
  };
}

function resolveItemSnapshot(
  item: ApplicationLogItem,
): ApplicationItemProductSnapshot | null {
  if (item.status === ApplicationItemStatus.Substituted) {
    return item.applied_snapshot ?? item.recommended_snapshot ?? null;
  }
  return item.applied_snapshot ?? item.recommended_snapshot ?? null;
}

function sortedItems(items: ApplicationLogItem[]): ApplicationLogItem[] {
  return items
    .slice()
    .sort((first, second) => first.step_order - second.step_order);
}

function ensureMemory(
  map: Map<string, ProductMemory>,
  product: RoutineMemoryProductDto,
): ProductMemory {
  const key = product.productId;
  if (!key) {
    throw new Error('Routine memory product key is required.');
  }
  const existing = map.get(key);
  if (existing) {
    existing.product = mergeProduct(existing.product, product);
    return existing;
  }
  const next: ProductMemory = {
    product,
    addedDate: null,
    firstUseDate: null,
    firstUseEventEmitted: false,
    lastUseDate: null,
    frequencyChangeDates: [],
    skippedDates: [],
  };
  map.set(key, next);
  return next;
}

function mergeProduct(
  existing: RoutineMemoryProductDto,
  next: RoutineMemoryProductDto,
): RoutineMemoryProductDto {
  return {
    productId: existing.productId ?? next.productId,
    brand: existing.brand ?? next.brand,
    name: existing.name ?? next.name,
    category: existing.category ?? next.category,
    imageUrl: existing.imageUrl ?? next.imageUrl,
  };
}

function applyLifetimeUsage(
  memoryByProduct: Map<string, ProductMemory>,
  productById: Map<string, RoutineMemoryProductDto>,
  rows: LifetimeProductUsageRow[],
): void {
  for (const row of rows) {
    const product = productById.get(row.productId);
    if (!product) continue;
    const memory = ensureMemory(memoryByProduct, product);
    memory.firstUseDate = normalizeDateOnly(row.firstUseDate);
    memory.lastUseDate = normalizeDateOnly(row.lastUseDate);
  }
}

function normalizeDateOnly(value: string | Date): string {
  return value instanceof Date ? toDateOnlyString(value) : value.slice(0, 10);
}

function eventTypeForRecentChange(
  kind: RecentChangeKind,
): RoutineMemoryEventType {
  return kind === 'changed_frequency'
    ? RoutineMemoryEventTypeValue.FrequencyChanged
    : RoutineMemoryEventTypeValue.RecentChangeLogged;
}

function hasReactionSignal(entry: SkinJournalEntry): boolean {
  return (
    entry.has_reaction_signal ||
    Boolean(entry.analysis_observations?.reaction_signals?.reaction_detected) ||
    Boolean(entry.reaction_report?.symptoms?.length) ||
    hasHighReactionRating(entry)
  );
}

function hasHighReactionRating(entry: SkinJournalEntry): boolean {
  const ratings = entry.ratings;
  if (!ratings) return false;
  return (
    (ratings.irritation ?? 0) >= 4 ||
    (ratings.redness ?? 0) >= 4 ||
    (ratings.breakouts ?? 0) >= 4 ||
    (ratings.sensitivity ?? 0) >= 4
  );
}

function reactionSeverity(
  report: ReactionReportPayload | null,
): RoutineMemoryEventSeverity {
  if (report?.red_flags?.length || report?.severity === 'severe') {
    return RoutineMemoryEventSeverityValue.Warning;
  }
  return RoutineMemoryEventSeverityValue.Watch;
}

function buildSuspiciousProducts(
  memoryByProduct: Map<string, ProductMemory>,
  reactionDates: string[],
): RoutineMemorySuspiciousProductDto[] {
  return Array.from(memoryByProduct.values())
    .map((memory) => scoreProductMemory(memory, reactionDates))
    .filter(
      (product): product is RoutineMemorySuspiciousProductDto =>
        product !== null,
    )
    .sort(compareSuspiciousProducts)
    .slice(0, 8);
}

function buildProductTimelines(
  memoryByProduct: Map<string, ProductMemory>,
  timeline: RoutineMemoryTimelineEventDto[],
  suspiciousProducts: RoutineMemorySuspiciousProductDto[],
): RoutineMemoryProductTimelineDto[] {
  const suspiciousByProductId = new Map(
    suspiciousProducts.map((product) => [product.productId, product]),
  );

  return Array.from(memoryByProduct.values())
    .map((memory) => {
      const productId = memory.product.productId;
      const suspicious = productId
        ? (suspiciousByProductId.get(productId) ?? null)
        : null;
      const productTimeline = timeline.filter((eventItem) =>
        isEventForProductTimeline(eventItem, memory, suspicious),
      );

      return {
        product: memory.product,
        suspicionLevel: suspicious?.suspicionLevel ?? null,
        reasonCodes: suspicious?.reasonCodes ?? [],
        firstUseDate: memory.firstUseDate,
        lastUseDate: memory.lastUseDate,
        nearestReactionDate: suspicious?.nearestReactionDate ?? null,
        eventCount: productTimeline.length,
        timeline: productTimeline,
      };
    })
    .sort(compareProductTimelines);
}

function isEventForProductTimeline(
  eventItem: RoutineMemoryTimelineEventDto,
  memory: ProductMemory,
  suspicious: RoutineMemorySuspiciousProductDto | null,
): boolean {
  const productId = memory.product.productId;
  if (!productId) return false;
  if (eventItem.product?.productId === productId) return true;

  if (eventItem.type === RoutineMemoryEventTypeValue.ReactionSignal) {
    return (
      Boolean(suspicious) && isReactionNearProductMemory(memory, eventItem.date)
    );
  }

  if (eventItem.type === RoutineMemoryEventTypeValue.RecoveryStarted) {
    return Boolean(
      suspicious?.nearestReactionDate &&
      isWithinForwardWindow(
        suspicious.nearestReactionDate,
        eventItem.date,
        REACTION_LINK_DAYS,
      ),
    );
  }

  return false;
}

function isReactionNearProductMemory(
  memory: ProductMemory,
  reactionDate: string,
): boolean {
  if (
    memory.firstUseDate &&
    isWithinForwardWindow(memory.firstUseDate, reactionDate, REACTION_LINK_DAYS)
  ) {
    return true;
  }
  if (
    memory.addedDate &&
    isWithinForwardWindow(
      memory.addedDate,
      reactionDate,
      PRODUCT_ADDED_LINK_DAYS,
    )
  ) {
    return true;
  }
  if (
    memory.frequencyChangeDates.some((date) =>
      isWithinForwardWindow(date, reactionDate, REACTION_LINK_DAYS),
    )
  ) {
    return true;
  }
  return memory.skippedDates.some((date) =>
    isWithinForwardWindow(reactionDate, date, REACTION_LINK_DAYS),
  );
}

function scoreProductMemory(
  memory: ProductMemory,
  reactionDates: string[],
): RoutineMemorySuspiciousProductDto | null {
  if (
    !memory.product.productId ||
    !memory.product.brand ||
    !memory.product.name
  ) {
    return null;
  }
  const reasonCodes = new Set<RoutineMemoryReasonCode>();
  let score = 0;
  let nearestReactionDate: string | null = null;
  let daysFromFirstUseToReaction: number | null = null;
  let reactionSignalCountNearUse = 0;

  for (const reactionDate of reactionDates) {
    const firstUseDistance = memory.firstUseDate
      ? daysBetween(memory.firstUseDate, reactionDate)
      : null;
    if (
      firstUseDistance !== null &&
      firstUseDistance >= 0 &&
      firstUseDistance <= REACTION_LINK_DAYS
    ) {
      score += addReason(
        reasonCodes,
        RoutineMemoryReasonCodeValue.ReactionAfterFirstLoggedUse,
        3,
      );
      reactionSignalCountNearUse += 1;
      nearestReactionDate = pickNearestReaction(
        nearestReactionDate,
        reactionDate,
        memory.firstUseDate,
      );
      daysFromFirstUseToReaction ??= firstUseDistance;
    }

    const addedDistance = memory.addedDate
      ? daysBetween(memory.addedDate, reactionDate)
      : null;
    if (
      addedDistance !== null &&
      addedDistance >= 0 &&
      addedDistance <= PRODUCT_ADDED_LINK_DAYS
    ) {
      score += addReason(
        reasonCodes,
        RoutineMemoryReasonCodeValue.ReactionAfterProductAdded,
        2,
      );
    }

    if (
      memory.frequencyChangeDates.some((date) =>
        isWithinForwardWindow(date, reactionDate, REACTION_LINK_DAYS),
      )
    ) {
      score += addReason(
        reasonCodes,
        RoutineMemoryReasonCodeValue.ReactionAfterFrequencyChange,
        3,
      );
    }

    if (
      memory.skippedDates.some((date) =>
        isWithinForwardWindow(reactionDate, date, REACTION_LINK_DAYS),
      )
    ) {
      score += addReason(
        reasonCodes,
        RoutineMemoryReasonCodeValue.SkippedAfterReaction,
        2,
      );
    }

    if (
      memory.firstUseDate &&
      ACTIVE_CATEGORIES.has(memory.product.category ?? '') &&
      isWithinForwardWindow(
        memory.firstUseDate,
        reactionDate,
        REACTION_LINK_DAYS,
      )
    ) {
      score += addReason(
        reasonCodes,
        RoutineMemoryReasonCodeValue.ActiveCategoryNearReaction,
        1,
      );
    }
  }

  if (reasonCodes.size === 0) return null;

  return {
    productId: memory.product.productId,
    brand: memory.product.brand,
    name: memory.product.name,
    category: memory.product.category,
    imageUrl: memory.product.imageUrl,
    suspicionLevel: suspicionLevel(score),
    score,
    reasonCodes: Array.from(reasonCodes),
    firstUseDate: memory.firstUseDate,
    lastUseDate: memory.lastUseDate,
    nearestReactionDate,
    daysFromFirstUseToReaction,
    reactionSignalCountNearUse,
  };
}

function addReason(
  reasonCodes: Set<RoutineMemoryReasonCode>,
  code: RoutineMemoryReasonCode,
  points: number,
): number {
  if (reasonCodes.has(code)) return 0;
  reasonCodes.add(code);
  return points;
}

function suspicionLevel(score: number): RoutineMemorySuspicionLevel {
  if (score >= 7) return RoutineMemorySuspicionLevelValue.HigherAttention;
  if (score >= 4) return RoutineMemorySuspicionLevelValue.Possible;
  return RoutineMemorySuspicionLevelValue.Watch;
}

function pickNearestReaction(
  current: string | null,
  candidate: string,
  anchorDate: string | null,
): string {
  if (!current || !anchorDate) return candidate;
  const currentDistance = Math.abs(daysBetween(anchorDate, current));
  const candidateDistance = Math.abs(daysBetween(anchorDate, candidate));
  return candidateDistance < currentDistance ? candidate : current;
}

function compareSuspiciousProducts(
  first: RoutineMemorySuspiciousProductDto,
  second: RoutineMemorySuspiciousProductDto,
): number {
  if (first.score !== second.score) return second.score - first.score;
  return first.name.localeCompare(second.name);
}

function compareProductTimelines(
  first: RoutineMemoryProductTimelineDto,
  second: RoutineMemoryProductTimelineDto,
): number {
  const firstSuspicion = suspicionRank(first.suspicionLevel);
  const secondSuspicion = suspicionRank(second.suspicionLevel);
  if (firstSuspicion !== secondSuspicion) {
    return secondSuspicion - firstSuspicion;
  }
  if (first.eventCount !== second.eventCount) {
    return second.eventCount - first.eventCount;
  }
  return productLabel(first.product).localeCompare(
    productLabel(second.product),
  );
}

function suspicionRank(level: RoutineMemorySuspicionLevel | null): number {
  if (level === RoutineMemorySuspicionLevelValue.HigherAttention) return 3;
  if (level === RoutineMemorySuspicionLevelValue.Possible) return 2;
  if (level === RoutineMemorySuspicionLevelValue.Watch) return 1;
  return 0;
}

function productLabel(product: RoutineMemoryProductDto): string {
  return [product.brand, product.name].filter(Boolean).join(' ').trim();
}

function isProductChangeEvent(
  eventItem: RoutineMemoryTimelineEventDto,
): boolean {
  return (
    eventItem.type === RoutineMemoryEventTypeValue.ProductAdded ||
    eventItem.type === RoutineMemoryEventTypeValue.FirstLoggedUse ||
    eventItem.type === RoutineMemoryEventTypeValue.FrequencyChanged ||
    eventItem.type === RoutineMemoryEventTypeValue.ProductSkipped ||
    eventItem.type === RoutineMemoryEventTypeValue.RecentChangeLogged
  );
}

function compareEvents(
  first: RoutineMemoryTimelineEventDto,
  second: RoutineMemoryTimelineEventDto,
): number {
  if (first.date !== second.date) return first.date < second.date ? -1 : 1;
  const priorityDiff = eventPriority(first.type) - eventPriority(second.type);
  if (priorityDiff !== 0) return priorityDiff;
  return first.id.localeCompare(second.id);
}

function eventPriority(type: RoutineMemoryEventType): number {
  switch (type) {
    case RoutineMemoryEventTypeValue.ProductAdded:
      return 10;
    case RoutineMemoryEventTypeValue.FirstLoggedUse:
      return 20;
    case RoutineMemoryEventTypeValue.ProductUsed:
      return 25;
    case RoutineMemoryEventTypeValue.FrequencyChanged:
      return 30;
    case RoutineMemoryEventTypeValue.RecentChangeLogged:
      return 35;
    case RoutineMemoryEventTypeValue.ReactionSignal:
      return 40;
    case RoutineMemoryEventTypeValue.RecoveryStarted:
      return 50;
    case RoutineMemoryEventTypeValue.ProductSkipped:
      return 60;
  }
}

function isWithinForwardWindow(
  fromDate: string,
  toDate: string,
  maxDays: number,
): boolean {
  const distance = daysBetween(fromDate, toDate);
  return distance >= 0 && distance <= maxDays;
}

function isDateInWindow(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function daysBetween(fromDate: string, toDate: string): number {
  const from = dateOnlyToUtc(fromDate).getTime();
  const to = dateOnlyToUtc(toDate).getTime();
  return Math.round((to - from) / 86_400_000);
}

function addDaysToDateOnly(date: string, days: number): string {
  const next = dateOnlyToUtc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function dateOnlyToUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function endOfDateOnlyUtc(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

function toNullableIso(value: Date | null | undefined): string | null {
  return value ? toIsoString(value) : null;
}
