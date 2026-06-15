import { toDateOnlyString } from '../../common/utils/date';
import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../../application-tracking/entities/application-log-item.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';
import {
  SUGGESTION_CONSERVATIVE_RESTART_AFTER_DAYS,
  SUGGESTION_REACTION_SKIP_PAUSE_DAYS,
} from '../suggestions.constants';
import { suggestionHistoryWindow } from './suggestion-historical-window';
import {
  daysBetween,
  increment,
  trimForPrompt,
  unique,
} from './suggestion-context-common';

export type ApplicationProductSignal = {
  adheredCount: number;
  reactionSkipCount: number;
  substitutedAwayCount: number;
  substitutedInCount: number;
};

export type ResolvedApplicationProduct = {
  productId: string | null;
  brand: string | null;
  name: string | null;
  category: string | null;
  stepLabel: string | null;
  sourceType: string;
  status: string;
  isOffShelf: boolean;
  isSubstitution: boolean;
  appliedAt: string | null;
};

type AppliedProductAccumulator = {
  productId: string | null;
  brand: string | null;
  name: string | null;
  category: string | null;
  stepLabel: string | null;
  sourceTypes: Set<string>;
  dayparts: Set<string>;
  statuses: Set<string>;
  useCount: number;
  lastAppliedDate: string | null;
  lastAppliedAt: string | null;
  isOffShelf: boolean;
  isSubstitution: boolean;
};

export function buildAppliedProductHistory(
  logs: ApplicationLog[],
  targetDate: string,
): NonNullable<SuggestionContextSummary['appliedProductHistory']> {
  const { fromDate, toDate } = suggestionHistoryWindow(targetDate);
  const byProduct = new Map<string, AppliedProductAccumulator>();

  for (const log of logs) {
    for (const item of log.items ?? []) {
      const product = resolveAppliedProduct(item);
      if (!product) continue;
      const key = applicationProductKey(product);
      const existing =
        byProduct.get(key) ??
        ({
          productId: product.productId,
          brand: product.brand,
          name: product.name,
          category: product.category,
          stepLabel: product.stepLabel,
          sourceTypes: new Set<string>(),
          dayparts: new Set<string>(),
          statuses: new Set<string>(),
          useCount: 0,
          lastAppliedDate: null,
          lastAppliedAt: null,
          isOffShelf: false,
          isSubstitution: false,
        } satisfies AppliedProductAccumulator);
      existing.sourceTypes.add(product.sourceType);
      if (log.daypart) existing.dayparts.add(log.daypart);
      existing.statuses.add(product.status);
      existing.useCount += 1;
      existing.isOffShelf = existing.isOffShelf || product.isOffShelf;
      existing.isSubstitution =
        existing.isSubstitution || product.isSubstitution;
      existing.category = existing.category ?? product.category;
      existing.stepLabel = existing.stepLabel ?? product.stepLabel;
      const appliedDate = toDateOnlyString(log.target_date);
      if (!existing.lastAppliedDate || existing.lastAppliedDate < appliedDate) {
        existing.lastAppliedDate = appliedDate;
      }
      const appliedAt =
        product.appliedAt ??
        log.applied_at?.toISOString() ??
        log.updated_at?.toISOString() ??
        null;
      if (
        appliedAt &&
        (!existing.lastAppliedAt || existing.lastAppliedAt < appliedAt)
      ) {
        existing.lastAppliedAt = appliedAt;
      }
      byProduct.set(key, existing);
    }
  }

  return {
    windowStartDate: fromDate,
    windowEndDate: toDate,
    recordsConsidered: logs.length,
    recentItems: buildRecentApplicationItems(logs, targetDate),
    products: Array.from(byProduct.values())
      .map((product) => ({
        productId: product.productId,
        brand: product.brand,
        name: product.name,
        category: product.category,
        stepLabel: product.stepLabel,
        sourceTypes: Array.from(product.sourceTypes),
        dayparts: Array.from(product.dayparts),
        statuses: Array.from(product.statuses),
        useCount: product.useCount,
        lastAppliedDate: product.lastAppliedDate,
        lastAppliedAt: product.lastAppliedAt,
        isOffShelf: product.isOffShelf,
        isSubstitution: product.isSubstitution,
      }))
      .sort(compareAppliedProductHistory)
      .slice(0, 50),
  };
}

function buildRecentApplicationItems(
  logs: ApplicationLog[],
  targetDate: string,
): NonNullable<
  NonNullable<SuggestionContextSummary['appliedProductHistory']>['recentItems']
> {
  return logs
    .filter((log) => toDateOnlyString(log.target_date) <= targetDate)
    .slice()
    .sort(compareApplicationLogRecency)
    .flatMap((log) =>
      (log.items ?? [])
        .slice()
        .sort((first, second) => first.step_order - second.step_order)
        .map((item) => {
          const recommended = resolveRecommendedProduct(item);
          const applied = resolveAppliedProduct(item);
          return {
            targetDate: toDateOnlyString(log.target_date),
            targetTime: log.target_time ?? null,
            daypart: log.daypart ?? null,
            status: item.status,
            itemSource: item.item_source ?? ApplicationItemSource.Recommended,
            stepLabel: item.step_label ?? recommended?.stepLabel ?? null,
            recommendedProductId: recommended?.productId ?? null,
            recommendedName: productDisplayName(recommended),
            recommendedCategory: recommended?.category ?? null,
            appliedProductId: applied?.productId ?? null,
            appliedName: productDisplayName(applied),
            appliedCategory: applied?.category ?? null,
            appliedAt:
              item.applied_at?.toISOString() ??
              log.applied_at?.toISOString() ??
              null,
            isOffShelf: applied?.isOffShelf ?? item.is_ad_hoc,
            isSubstitution: item.status === ApplicationItemStatus.Substituted,
            notes: trimNullablePromptText(item.notes, 120),
            substitutionReason: trimNullablePromptText(
              item.substitution_reason,
              120,
            ),
          };
        }),
    )
    .slice(0, 30);
}

export function buildApplicationProductSignals(
  logs: ApplicationLog[],
  targetDate: string,
): Map<string, ApplicationProductSignal> {
  const map = new Map<string, ApplicationProductSignal>();
  for (const log of logs) {
    const skippedItems = (log.items ?? []).filter(
      (item) => item.status === ApplicationItemStatus.Skipped,
    );
    for (const item of log.items ?? []) {
      const applied = resolveAppliedProduct(item);
      const recommended = resolveRecommendedProduct(item);
      if (
        item.status === ApplicationItemStatus.Skipped &&
        recommended?.productId &&
        isReactionRelatedSkip(log, item, targetDate, skippedItems.length)
      ) {
        productSignal(map, recommended.productId).reactionSkipCount += 1;
      }
      if (
        item.status === ApplicationItemStatus.Substituted &&
        recommended?.productId
      ) {
        productSignal(map, recommended.productId).substitutedAwayCount += 1;
      }
      if (
        item.status === ApplicationItemStatus.Substituted &&
        applied?.productId
      ) {
        productSignal(map, applied.productId).substitutedInCount += 1;
        productSignal(map, applied.productId).adheredCount += 1;
      }
      if (item.status === ApplicationItemStatus.Applied && applied?.productId) {
        productSignal(map, applied.productId).adheredCount += 1;
      }
    }
  }
  return map;
}

export function isReactionRelatedSkipReason(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  return REACTION_SKIP_REASON_PATTERN.test(value);
}

export function buildApplicationPatterns(
  logs: ApplicationLog[],
  targetDate: string,
): SuggestionContextSummary['applicationPatterns'] {
  const skippedByCategory: Record<string, number> = {};
  const substitutedByCategory: Record<string, number> = {};
  const adherenceByCategory: Record<string, number> = {};
  let addedOffShelfCount = 0;
  let editedLogCount = 0;
  const applicationDates = logs
    .map((log) => toDateOnlyString(log.target_date))
    .filter((date) => date <= toDateOnlyString(targetDate))
    .sort((a, b) => (a < b ? 1 : -1));
  const daysSinceLastApplication = applicationDates[0]
    ? daysBetween(applicationDates[0], targetDate)
    : null;
  for (const log of logs) {
    if (log.has_been_edited) editedLogCount += 1;
    for (const item of log.items ?? []) {
      const category = item.step_label ?? 'unknown';
      if (item.status === 'skipped') increment(skippedByCategory, category);
      if (item.status === 'substituted')
        increment(substitutedByCategory, category);
      if (item.status === 'applied') increment(adherenceByCategory, category);
      if (item.is_ad_hoc) addedOffShelfCount += 1;
    }
  }
  return {
    days: unique(logs.map((log) => toDateOnlyString(log.target_date))).length,
    daysSinceLastApplication,
    conservativeRestart:
      daysSinceLastApplication === null ||
      daysSinceLastApplication >= SUGGESTION_CONSERVATIVE_RESTART_AFTER_DAYS,
    skippedByCategory,
    substitutedByCategory,
    addedOffShelfCount,
    editedLogCount,
    adherenceByCategory,
  };
}

export function buildRecentUseByProduct(
  logs: ApplicationLog[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const log of logs) {
    for (const item of log.items ?? []) {
      const product = resolveAppliedProduct(item);
      if (product?.productId) {
        map.set(product.productId, (map.get(product.productId) ?? 0) + 1);
      }
    }
  }
  return map;
}

export function resolveAppliedProduct(
  item: ApplicationLogItem,
): ResolvedApplicationProduct | null {
  if (item.status === ApplicationItemStatus.Skipped) return null;
  const snapshot =
    item.applied_snapshot ??
    (item.status === ApplicationItemStatus.Applied
      ? item.recommended_snapshot
      : null);
  const product =
    item.status === ApplicationItemStatus.Substituted
      ? item.substituted_with_product
      : item.product;
  const productId =
    snapshot?.product_id ??
    (item.status === ApplicationItemStatus.Substituted
      ? item.substituted_with_product_id
      : item.inventory_product_id) ??
    product?.id ??
    null;
  const brand =
    snapshot?.brand ??
    product?.brand ??
    item.ad_hoc_brand ??
    item.product_brand_snapshot ??
    null;
  const name =
    snapshot?.name ??
    product?.name ??
    item.ad_hoc_name ??
    item.product_name_snapshot ??
    null;
  if (!productId && !brand && !name) return null;
  return {
    productId,
    brand,
    name,
    category: product?.category ?? null,
    stepLabel:
      snapshot?.step_label ?? item.step_label ?? product?.category ?? null,
    sourceType: item.item_source ?? ApplicationItemSource.Recommended,
    status: item.status,
    isOffShelf:
      item.is_ad_hoc ||
      item.item_source === ApplicationItemSource.AddedOffShelf ||
      (!productId && Boolean(brand || name)),
    isSubstitution: item.status === ApplicationItemStatus.Substituted,
    appliedAt: item.applied_at?.toISOString() ?? null,
  };
}

export function applicationProductKey(
  product: ResolvedApplicationProduct,
): string {
  if (product.productId) return product.productId;
  return [product.brand, product.name, product.category, product.stepLabel]
    .filter(Boolean)
    .join(':')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function productSignal(
  map: Map<string, ApplicationProductSignal>,
  productId: string,
): ApplicationProductSignal {
  const existing = map.get(productId);
  if (existing) return existing;
  const created = {
    adheredCount: 0,
    reactionSkipCount: 0,
    substitutedAwayCount: 0,
    substitutedInCount: 0,
  };
  map.set(productId, created);
  return created;
}

const REACTION_SKIP_REASON_PATTERN =
  /\b(reaction|reacted|irritat(?:e|ed|ing|ion)|sting(?:ing)?|burn(?:ing|ed)?|redness|r(?:o|\u00f6)d|rash|itch(?:y|ing)?|swelling|allerg(?:y|ic)|hives|sensiti[sz](?:ed|ation)|peel(?:ing|ed)?|flak(?:ing|ed)?|break(?:out|ing out)|broke me out|pimple|acne flare|blemish|sore|painful|sveda|br(?:a|\u00e4)nn(?:er|ande|t)?|rodnad|irritation|kl(?:a|\u00e5)da|utslag|svullnad|allergi|finnar|akneutbrott|stickningar)\b/i;

function isReactionRelatedSkip(
  log: ApplicationLog,
  item: ApplicationLogItem,
  targetDate: string,
  skippedItemCount: number,
): boolean {
  const logDate = toDateOnlyString(log.target_date);
  const normalizedTargetDate = toDateOnlyString(targetDate);
  if (logDate > normalizedTargetDate) return false;
  if (
    daysBetween(logDate, normalizedTargetDate) >
    SUGGESTION_REACTION_SKIP_PAUSE_DAYS
  ) {
    return false;
  }
  if (isReactionRelatedSkipReason(item.notes)) return true;
  if (
    skippedItemCount === 1 &&
    isReactionRelatedSkipReason(log.general_notes)
  ) {
    return true;
  }
  return false;
}

function compareAppliedProductHistory(
  first: NonNullable<
    SuggestionContextSummary['appliedProductHistory']
  >['products'][number],
  second: NonNullable<
    SuggestionContextSummary['appliedProductHistory']
  >['products'][number],
): number {
  if (first.useCount !== second.useCount)
    return second.useCount - first.useCount;
  const firstApplied = first.lastAppliedAt ?? first.lastAppliedDate ?? '';
  const secondApplied = second.lastAppliedAt ?? second.lastAppliedDate ?? '';
  if (firstApplied !== secondApplied)
    return firstApplied < secondApplied ? 1 : -1;
  return (first.name ?? '').localeCompare(second.name ?? '');
}

function compareApplicationLogRecency(
  first: ApplicationLog,
  second: ApplicationLog,
): number {
  const firstDate = toDateOnlyString(first.target_date);
  const secondDate = toDateOnlyString(second.target_date);
  if (firstDate !== secondDate) return firstDate < secondDate ? 1 : -1;
  const firstTime = first.target_time ?? '';
  const secondTime = second.target_time ?? '';
  if (firstTime !== secondTime) return firstTime < secondTime ? 1 : -1;
  const firstUpdated = first.updated_at?.getTime() ?? 0;
  const secondUpdated = second.updated_at?.getTime() ?? 0;
  return secondUpdated - firstUpdated;
}

function productDisplayName(
  product: ResolvedApplicationProduct | null,
): string | null {
  if (!product) return null;
  return [product.brand, product.name]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
    .trim();
}

function trimNullablePromptText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (!value) return null;
  const trimmed = trimForPrompt(value, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveRecommendedProduct(
  item: ApplicationLogItem,
): ResolvedApplicationProduct | null {
  const snapshot = item.recommended_snapshot;
  const productId =
    snapshot?.product_id ??
    item.inventory_product_id ??
    item.product?.id ??
    null;
  const brand =
    snapshot?.brand ??
    item.product?.brand ??
    item.product_brand_snapshot ??
    item.ad_hoc_brand ??
    null;
  const name =
    snapshot?.name ??
    item.product?.name ??
    item.product_name_snapshot ??
    item.ad_hoc_name ??
    null;
  if (!productId && !brand && !name) return null;
  return {
    productId,
    brand,
    name,
    category: item.product?.category ?? null,
    stepLabel:
      snapshot?.step_label ?? item.step_label ?? item.product?.category ?? null,
    sourceType: item.item_source ?? ApplicationItemSource.Recommended,
    status: item.status,
    isOffShelf:
      item.is_ad_hoc ||
      item.item_source === ApplicationItemSource.AddedOffShelf ||
      (!productId && Boolean(brand || name)),
    isSubstitution: false,
    appliedAt: item.applied_at?.toISOString() ?? null,
  };
}
