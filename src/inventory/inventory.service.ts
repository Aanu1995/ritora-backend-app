import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import {
  decodeCursor,
  encodeCursor,
  type PaginatedResult,
} from '../common/utils/cursor-pagination';
import { nowDate, toDateOrNull, toIsoString } from '../common/utils/date';
import { computeEffectiveExpiresAt } from '../shelf/shelf-life';
import {
  normalizeApplicationGuidanceSnapshot,
  normalizeCatalogueIdentitySnapshot,
  normalizeManufacturerInfoSnapshot,
  normalizeUserFieldsSnapshot,
} from '../shelf/shelf-payload-normalizer';
import {
  type ApplicationGuidance,
  type CatalogueIdentity,
  DataProvenance,
  type ManufacturerInfo,
  ShelfSort,
  ShelfStatFilter,
  ShelfStatus,
  type ShelfProductSnapshot,
  type UserFields,
} from '../shelf/shelf.types';
import { CreateInventoryProductDto } from './dto/create-inventory-product.dto';
import { InventoryListQueryDto } from './dto/inventory-list-query.dto';
import { InventoryProductResponseDto } from './dto/inventory-product-response.dto';
import { UpdateInventoryProductDto } from './dto/update-inventory-product.dto';
import { InventoryProduct } from './entities/inventory-product.entity';
import { assertValidInventoryDraft } from './inventory.validation';

function normalizeSearchValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function buildSearchDocument(snapshot: ShelfProductSnapshot): string {
  const parts = [
    snapshot.identity.brand,
    snapshot.identity.name,
    snapshot.identity.category,
    snapshot.identity.description,
    ...snapshot.identity.benefits,
    ...snapshot.identity.suitedFor,
    ...snapshot.identity.inciIngredients,
    snapshot.manufacturer.brand,
    snapshot.manufacturer.parentCompany,
    snapshot.userFields.purchasedFrom,
  ];

  return parts
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function mergeDraft(
  existing: ShelfProductSnapshot,
  patch: UpdateInventoryProductDto,
): ShelfProductSnapshot {
  return {
    identity: {
      ...existing.identity,
      ...(patch.identity ?? {}),
    },
    guidance: {
      ...existing.guidance,
      ...(patch.guidance ?? {}),
    },
    manufacturer: {
      ...existing.manufacturer,
      ...(patch.manufacturer ?? {}),
      brand:
        patch.manufacturer?.brand ??
        existing.manufacturer.brand ??
        existing.identity.brand,
    },
    userFields: {
      ...existing.userFields,
      ...(patch.userFields ?? {}),
    },
    status: patch.status ?? existing.status,
    provenance: patch.provenance ?? existing.provenance,
  };
}

function toSnapshotFromCreateDto(
  dto: CreateInventoryProductDto,
): ShelfProductSnapshot {
  const identity: CatalogueIdentity = {
    brand: dto.identity.brand,
    name: dto.identity.name,
    category: dto.identity.category,
    barcode: dto.identity.barcode ?? null,
    imageUrls: [...dto.identity.imageUrls],
    sizeMl: dto.identity.sizeMl,
    description: dto.identity.description,
    benefits: [...dto.identity.benefits],
    suitedFor: [...dto.identity.suitedFor],
    inciIngredients: [...dto.identity.inciIngredients],
    inciLastConfirmedAt: dto.identity.inciLastConfirmedAt ?? null,
  };

  const guidance: ApplicationGuidance = {
    applicationMethod: dto.guidance.applicationMethod ?? null,
    quantity: dto.guidance.quantity ?? null,
    steps: [...dto.guidance.steps],
    cautions: [...dto.guidance.cautions],
    waitMinutes: dto.guidance.waitMinutes ?? null,
  };

  const manufacturer: ManufacturerInfo = {
    brand: dto.manufacturer.brand ?? dto.identity.brand,
    parentCompany: dto.manufacturer.parentCompany ?? null,
    countryOfOrigin: dto.manufacturer.countryOfOrigin ?? null,
    countryOfManufacture: dto.manufacturer.countryOfManufacture ?? null,
    supportEmail: dto.manufacturer.supportEmail ?? null,
    productUrl: dto.manufacturer.productUrl ?? null,
    websiteUrl: dto.manufacturer.websiteUrl ?? null,
  };

  const userFields: UserFields = {
    openedAt: dto.userFields.openedAt ?? null,
    expiresAt: dto.userFields.expiresAt ?? null,
    periodAfterOpeningMonths: dto.userFields.periodAfterOpeningMonths ?? null,
    pricePaid: dto.userFields.pricePaid ?? null,
    pricePaidCurrency: dto.userFields.pricePaidCurrency ?? null,
    purchasedFrom: dto.userFields.purchasedFrom ?? null,
    personalNotes: dto.userFields.personalNotes ?? null,
    preferredTimeOfDay: dto.userFields.preferredTimeOfDay ?? null,
  };

  return {
    identity,
    guidance,
    manufacturer,
    userFields,
    status: dto.status ?? ShelfStatus.Active,
    provenance: dto.provenance ?? DataProvenance.UserEntered,
  };
}

function normalizeDraft(draft: ShelfProductSnapshot): ShelfProductSnapshot {
  const identity = normalizeCatalogueIdentitySnapshot({
    ...draft.identity,
    brand: draft.identity.brand.trim(),
    name: draft.identity.name.trim(),
    barcode: trimOrNull(draft.identity.barcode),
    description: trimOrNull(draft.identity.description),
    benefits: normalizeStringList(draft.identity.benefits),
    suitedFor: normalizeStringList(draft.identity.suitedFor),
    inciIngredients: normalizeStringList(draft.identity.inciIngredients),
    inciLastConfirmedAt: trimOrNull(draft.identity.inciLastConfirmedAt),
  });
  const guidance = normalizeApplicationGuidanceSnapshot({
    ...draft.guidance,
    steps: normalizeStringList(draft.guidance.steps),
    cautions: normalizeStringList(draft.guidance.cautions),
  });
  const manufacturer = normalizeManufacturerInfoSnapshot(
    {
      ...draft.manufacturer,
      brand: trimOrNull(draft.manufacturer.brand) ?? identity.brand,
      parentCompany: trimOrNull(draft.manufacturer.parentCompany),
      countryOfOrigin: trimOrNull(draft.manufacturer.countryOfOrigin),
      countryOfManufacture: trimOrNull(draft.manufacturer.countryOfManufacture),
      supportEmail: trimOrNull(draft.manufacturer.supportEmail),
      productUrl: trimOrNull(draft.manufacturer.productUrl),
      websiteUrl: trimOrNull(draft.manufacturer.websiteUrl),
    },
    identity.brand,
  );
  const userFields = normalizeUserFieldsSnapshot({
    ...draft.userFields,
    openedAt: trimOrNull(draft.userFields.openedAt),
    expiresAt: trimOrNull(draft.userFields.expiresAt),
    pricePaidCurrency: trimOrNull(draft.userFields.pricePaidCurrency),
    purchasedFrom: trimOrNull(draft.userFields.purchasedFrom),
    personalNotes: trimOrNull(draft.userFields.personalNotes),
  });

  return {
    identity,
    guidance,
    manufacturer,
    userFields,
    status: draft.status ?? ShelfStatus.Active,
    provenance: draft.provenance ?? DataProvenance.UserEntered,
  };
}

type InventorySortTuple =
  | [string, string]
  | [string, string, string]
  | [string, string, string, string];

type InventoryCursorTuple = [string, string] | [string, string, string];

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepository: Repository<InventoryProduct>,
  ) {}

  async list(
    userId: string,
    query: InventoryListQueryDto,
  ): Promise<PaginatedResult<InventoryProductResponseDto>> {
    const fingerprint = this.buildFingerprint(userId, query);
    const queryBuilder = this.createListQueryBuilder(userId, query);

    this.applySort(queryBuilder, query.sort);
    this.applyCursor(queryBuilder, query.sort, query.cursor, fingerprint);

    const entities = await queryBuilder.take(query.limit + 1).getMany();
    const hasMore = entities.length > query.limit;
    const pageEntities = hasMore ? entities.slice(0, query.limit) : entities;
    const items = pageEntities.map((product) =>
      InventoryProductResponseDto.fromEntity(product),
    );
    const nextCursor = this.buildNextCursor(
      pageEntities.at(-1),
      query.sort,
      fingerprint,
      hasMore,
    );

    return { items, nextCursor };
  }

  async getStats(userId: string): Promise<Record<ShelfStatFilter, number>> {
    const now = nowDate();
    return this.countStats(userId, now);
  }

  async getOne(
    userId: string,
    id: string,
  ): Promise<InventoryProductResponseDto> {
    const product = await this.findByIdOrFail(userId, id);
    return InventoryProductResponseDto.fromEntity(product);
  }

  async create(
    userId: string,
    dto: CreateInventoryProductDto,
  ): Promise<InventoryProductResponseDto> {
    assertValidInventoryDraft(dto);
    const normalized = normalizeDraft(toSnapshotFromCreateDto(dto));

    const entity = this.inventoryRepository.create(
      this.toEntityPayload(userId, normalized),
    );
    const saved = await this.inventoryRepository.save(entity);
    return InventoryProductResponseDto.fromEntity(saved);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateInventoryProductDto,
  ): Promise<InventoryProductResponseDto> {
    const product = await this.findByIdOrFail(userId, id);
    const merged = mergeDraft(this.toSnapshot(product), dto);
    assertValidInventoryDraft(merged);
    const normalized = normalizeDraft(merged);

    Object.assign(product, this.toEntityPayload(userId, normalized));
    const saved = await this.inventoryRepository.save(product);
    return InventoryProductResponseDto.fromEntity(saved);
  }

  async remove(userId: string, id: string): Promise<void> {
    const product = await this.findByIdOrFail(userId, id);
    await this.inventoryRepository.remove(product);
  }

  async removeMany(userId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.inventoryRepository.delete({
      user_id: userId,
      id: In(ids),
    });
  }

  async archive(
    userId: string,
    id: string,
  ): Promise<InventoryProductResponseDto> {
    return this.updateStatus(userId, id, ShelfStatus.Archived);
  }

  async restore(
    userId: string,
    id: string,
  ): Promise<InventoryProductResponseDto> {
    return this.updateStatus(userId, id, ShelfStatus.Active);
  }

  async markFinished(
    userId: string,
    id: string,
  ): Promise<InventoryProductResponseDto> {
    return this.updateStatus(userId, id, ShelfStatus.FinishedUp);
  }

  async archiveMany(userId: string, ids: string[]): Promise<void> {
    await this.updateManyStatuses(userId, ids, ShelfStatus.Archived);
  }

  async restoreMany(userId: string, ids: string[]): Promise<void> {
    await this.updateManyStatuses(userId, ids, ShelfStatus.Active);
  }

  async markFinishedMany(userId: string, ids: string[]): Promise<void> {
    await this.updateManyStatuses(userId, ids, ShelfStatus.FinishedUp);
  }

  private async updateStatus(
    userId: string,
    id: string,
    status: ShelfStatus,
  ): Promise<InventoryProductResponseDto> {
    const product = await this.findByIdOrFail(userId, id);
    product.status = status;
    const saved = await this.inventoryRepository.save(product);
    return InventoryProductResponseDto.fromEntity(saved);
  }

  private async updateManyStatuses(
    userId: string,
    ids: string[],
    status: ShelfStatus,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.inventoryRepository.update(
      {
        user_id: userId,
        id: In(ids),
      },
      {
        status,
      },
    );
  }

  private buildFingerprint(
    userId: string,
    query: InventoryListQueryDto,
  ): string {
    return [
      'inventory',
      userId,
      query.stat,
      query.category,
      normalizeSearchValue(query.search),
      query.sort,
      query.limit,
    ].join(':');
  }

  private buildNextCursor(
    item: InventoryProduct | undefined,
    sort: ShelfSort,
    fingerprint: string,
    hasMore: boolean,
  ): string | null {
    if (!hasMore || !item) {
      return null;
    }

    return encodeCursor({
      fingerprint,
      tuple: this.buildCursorTuple(item, sort),
    });
  }

  private buildCursorTuple(
    item: InventoryProduct,
    sort: ShelfSort,
  ): InventorySortTuple {
    switch (sort) {
      case ShelfSort.Alphabetical:
        return [item.name_search, item.id];
      case ShelfSort.CategoryGrouped:
        return [item.category, item.name_search, item.id];
      case ShelfSort.ExpiringSoon: {
        return [
          item.effective_expires_at
            ? toIsoString(item.effective_expires_at)
            : '',
          item.id,
        ];
      }
      case ShelfSort.RecentlyAdded:
      default:
        return [toIsoString(item.created_at), item.id];
    }
  }

  private createListQueryBuilder(
    userId: string,
    query: InventoryListQueryDto,
  ): SelectQueryBuilder<InventoryProduct> {
    const queryBuilder = this.inventoryRepository
      .createQueryBuilder('inventory')
      .where('inventory.user_id = :userId', { userId });

    this.applyStatFilter(queryBuilder, query.stat);

    if (query.category !== 'all') {
      queryBuilder.andWhere('inventory.category = :category', {
        category: query.category,
      });
    }

    const normalizedSearch = normalizeSearchValue(query.search);
    this.applySearchFilter(queryBuilder, normalizedSearch);

    return queryBuilder;
  }

  private applySearchFilter(
    queryBuilder: SelectQueryBuilder<InventoryProduct>,
    normalizedSearch: string,
  ) {
    if (!normalizedSearch) {
      return;
    }

    const searchLike = `%${normalizedSearch}%`;

    queryBuilder.andWhere('inventory.search_document LIKE :searchLike', {
      searchLike,
    });
  }

  private applySort(
    queryBuilder: SelectQueryBuilder<InventoryProduct>,
    sort: ShelfSort,
  ) {
    switch (sort) {
      case ShelfSort.Alphabetical:
        queryBuilder
          .orderBy('inventory.name_search', 'ASC')
          .addOrderBy('inventory.id', 'ASC');
        return;
      case ShelfSort.CategoryGrouped:
        queryBuilder
          .orderBy('inventory.category', 'ASC')
          .addOrderBy('inventory.name_search', 'ASC')
          .addOrderBy('inventory.id', 'ASC');
        return;
      case ShelfSort.ExpiringSoon:
        queryBuilder
          .orderBy('inventory.effective_expires_at', 'ASC', 'NULLS LAST')
          .addOrderBy('inventory.id', 'ASC');
        return;
      case ShelfSort.RecentlyAdded:
      default:
        queryBuilder
          .orderBy('inventory.created_at', 'DESC')
          .addOrderBy('inventory.id', 'DESC');
        return;
    }
  }

  private applyCursor(
    queryBuilder: SelectQueryBuilder<InventoryProduct>,
    sort: ShelfSort,
    cursor: string | undefined,
    fingerprint: string,
  ) {
    if (!cursor) {
      return;
    }

    const decoded = decodeCursor(cursor);
    if (decoded.fingerprint !== fingerprint) {
      throw new BadRequestException('Cursor does not match this request');
    }

    const tuple = decoded.tuple as InventoryCursorTuple;

    switch (sort) {
      case ShelfSort.Alphabetical: {
        const [name, id] = tuple;
        queryBuilder.andWhere(
          new Brackets((qb) => {
            qb.where('inventory.name_search > :cursorName', {
              cursorName: String(name),
            }).orWhere(
              'inventory.name_search = :cursorName AND inventory.id > :cursorId',
              {
                cursorName: String(name),
                cursorId: String(id),
              },
            );
          }),
        );
        return;
      }
      case ShelfSort.CategoryGrouped: {
        const [category, name, id] = tuple;
        queryBuilder.andWhere(
          new Brackets((qb) => {
            qb.where('inventory.category > :cursorCategory', {
              cursorCategory: String(category),
            })
              .orWhere(
                new Brackets((inner) => {
                  inner
                    .where('inventory.category = :cursorCategory', {
                      cursorCategory: String(category),
                    })
                    .andWhere('inventory.name_search > :cursorName', {
                      cursorName: String(name),
                    });
                }),
              )
              .orWhere(
                new Brackets((inner) => {
                  inner
                    .where('inventory.category = :cursorCategory', {
                      cursorCategory: String(category),
                    })
                    .andWhere('inventory.name_search = :cursorName', {
                      cursorName: String(name),
                    })
                    .andWhere('inventory.id > :cursorId', {
                      cursorId: String(id),
                    });
                }),
              );
          }),
        );
        return;
      }
      case ShelfSort.ExpiringSoon: {
        const [effectiveExpiresAt, id] = tuple;

        if (!effectiveExpiresAt) {
          queryBuilder.andWhere(
            'inventory.effective_expires_at IS NULL AND inventory.id > :cursorId',
            {
              cursorId: String(id),
            },
          );
          return;
        }

        queryBuilder.andWhere(
          new Brackets((qb) => {
            qb.where('inventory.effective_expires_at IS NULL').orWhere(
              new Brackets((inner) => {
                inner
                  .where(
                    'inventory.effective_expires_at > :cursorEffectiveExpiresAt',
                    {
                      cursorEffectiveExpiresAt: effectiveExpiresAt,
                    },
                  )
                  .orWhere(
                    'inventory.effective_expires_at = :cursorEffectiveExpiresAt AND inventory.id > :cursorId',
                    {
                      cursorEffectiveExpiresAt: effectiveExpiresAt,
                      cursorId: String(id),
                    },
                  );
              }),
            );
          }),
        );
        return;
      }
      case ShelfSort.RecentlyAdded:
      default: {
        const [createdAt, id] = tuple;
        queryBuilder.andWhere(
          new Brackets((qb) => {
            qb.where('inventory.created_at < :cursorCreatedAt', {
              cursorCreatedAt: createdAt,
            }).orWhere(
              'inventory.created_at = :cursorCreatedAt AND inventory.id < :cursorId',
              {
                cursorCreatedAt: createdAt,
                cursorId: String(id),
              },
            );
          }),
        );
      }
    }
  }

  private applyStatFilter(
    queryBuilder: SelectQueryBuilder<InventoryProduct>,
    stat: ShelfStatFilter,
    now: Date = nowDate(),
  ) {
    const params = {
      archived: ShelfStatus.Archived,
      active: ShelfStatus.Active,
      now: toIsoString(now),
    };

    switch (stat) {
      case ShelfStatFilter.Archived:
        queryBuilder.andWhere('inventory.status = :archived', params);
        return;
      case ShelfStatFilter.InUse:
        queryBuilder
          .andWhere('inventory.status = :active', params)
          .andWhere('inventory.opened_at IS NOT NULL');
        return;
      case ShelfStatFilter.Unopened:
        queryBuilder
          .andWhere('inventory.status = :active', params)
          .andWhere('inventory.opened_at IS NULL');
        return;
      case ShelfStatFilter.Expired:
        queryBuilder
          .andWhere('inventory.status != :archived', params)
          .andWhere('inventory.opened_at IS NOT NULL')
          .andWhere('inventory.effective_expires_at IS NOT NULL')
          .andWhere('inventory.effective_expires_at <= :now', params);
        return;
      case ShelfStatFilter.NearingExpiry:
        queryBuilder
          .andWhere('inventory.status != :archived', params)
          .andWhere('inventory.opened_at IS NOT NULL')
          .andWhere('inventory.effective_expires_at IS NOT NULL')
          .andWhere(
            new Brackets((qb) => {
              qb.where(
                'inventory.effective_expires_at <= :now',
                params,
              ).orWhere(
                ':now >= inventory.opened_at + ((inventory.effective_expires_at - inventory.opened_at) / 2.0)',
                params,
              );
            }),
          );
        return;
      case ShelfStatFilter.All:
      default:
        queryBuilder.andWhere('inventory.status != :archived', params);
    }
  }

  private async countStats(
    userId: string,
    now: Date,
  ): Promise<Record<ShelfStatFilter, number>> {
    const nowIso = toIsoString(now);
    const rawCounts = await this.inventoryRepository
      .createQueryBuilder('inventory')
      .select(
        `COUNT(*) FILTER (WHERE inventory.status != :archived)`,
        ShelfStatFilter.All,
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE inventory.status = :active AND inventory.opened_at IS NOT NULL)`,
        ShelfStatFilter.InUse,
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE inventory.status = :active AND inventory.opened_at IS NULL)`,
        ShelfStatFilter.Unopened,
      )
      .addSelect(
        `COUNT(*) FILTER (
          WHERE inventory.status != :archived
            AND inventory.opened_at IS NOT NULL
            AND inventory.effective_expires_at IS NOT NULL
            AND (
              inventory.effective_expires_at <= :now
              OR :now >= inventory.opened_at + ((inventory.effective_expires_at - inventory.opened_at) / 2.0)
            )
        )`,
        ShelfStatFilter.NearingExpiry,
      )
      .addSelect(
        `COUNT(*) FILTER (
          WHERE inventory.status != :archived
            AND inventory.opened_at IS NOT NULL
            AND inventory.effective_expires_at IS NOT NULL
            AND inventory.effective_expires_at <= :now
        )`,
        ShelfStatFilter.Expired,
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE inventory.status = :archived)`,
        ShelfStatFilter.Archived,
      )
      .where('inventory.user_id = :userId', { userId })
      .setParameters({
        active: ShelfStatus.Active,
        archived: ShelfStatus.Archived,
        now: nowIso,
      })
      .getRawOne<Record<ShelfStatFilter, string | null>>();

    return {
      [ShelfStatFilter.All]: Number(rawCounts?.[ShelfStatFilter.All] ?? 0),
      [ShelfStatFilter.InUse]: Number(rawCounts?.[ShelfStatFilter.InUse] ?? 0),
      [ShelfStatFilter.Unopened]: Number(
        rawCounts?.[ShelfStatFilter.Unopened] ?? 0,
      ),
      [ShelfStatFilter.NearingExpiry]: Number(
        rawCounts?.[ShelfStatFilter.NearingExpiry] ?? 0,
      ),
      [ShelfStatFilter.Expired]: Number(
        rawCounts?.[ShelfStatFilter.Expired] ?? 0,
      ),
      [ShelfStatFilter.Archived]: Number(
        rawCounts?.[ShelfStatFilter.Archived] ?? 0,
      ),
    };
  }

  private toSnapshot(product: InventoryProduct): ShelfProductSnapshot {
    return {
      identity: product.identity,
      guidance: product.guidance,
      manufacturer: product.manufacturer,
      userFields: product.user_fields,
      status: product.status,
      provenance: product.provenance,
    };
  }

  private toEntityPayload(
    userId: string,
    snapshot: ShelfProductSnapshot,
  ): Partial<InventoryProduct> {
    const effectiveExpiresAt = computeEffectiveExpiresAt(snapshot);
    const searchDocument = buildSearchDocument(snapshot);

    return {
      user_id: userId,
      catalogue_product_id: null,
      brand: snapshot.identity.brand,
      name: snapshot.identity.name,
      category: snapshot.identity.category,
      barcode: snapshot.identity.barcode,
      status: snapshot.status,
      provenance: snapshot.provenance,
      brand_search: normalizeSearchValue(snapshot.identity.brand),
      name_search: normalizeSearchValue(snapshot.identity.name),
      search_document: searchDocument,
      opened_at: toDateOrNull(snapshot.userFields.openedAt),
      expires_at: toDateOrNull(snapshot.userFields.expiresAt),
      period_after_opening_months:
        snapshot.userFields.periodAfterOpeningMonths ?? null,
      effective_expires_at: effectiveExpiresAt,
      identity: snapshot.identity,
      guidance: snapshot.guidance,
      manufacturer: snapshot.manufacturer,
      user_fields: snapshot.userFields,
    };
  }

  private async findByIdOrFail(
    userId: string,
    id: string,
  ): Promise<InventoryProduct> {
    const product = await this.inventoryRepository.findOne({
      where: { id, user_id: userId },
    });

    if (!product) {
      throw new NotFoundException('Inventory product not found');
    }

    return product;
  }
}
