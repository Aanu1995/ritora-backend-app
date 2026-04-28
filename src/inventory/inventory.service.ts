import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { CataloguePhotoProcessorService } from '../catalogue/catalogue-photo-processor.service';
import { CataloguePhotoStorageService } from '../catalogue/catalogue-photo-storage.service';
import type { UploadedCatalogueImage } from '../catalogue/catalogue-photo.types';
import {
  decodeCursor,
  encodeCursor,
  type PaginatedResult,
} from '../common/utils/cursor-pagination';
import { toDateOrNull, toIsoString } from '../common/utils/date';
import { computeEffectiveExpiresAt } from '../shelf/shelf-life';
import {
  ShelfSort,
  ShelfStatFilter,
  ShelfStatus,
  DataProvenance,
  type ShelfProductSnapshot,
} from '../shelf/shelf.types';
import { CreateInventoryProductDto } from './dto/create-inventory-product.dto';
import { InventoryListQueryDto } from './dto/inventory-list-query.dto';
import { InventoryProductResponseDto } from './dto/inventory-product-response.dto';
import { UpdateInventoryProductDto } from './dto/update-inventory-product.dto';
import { InventoryProduct } from './entities/inventory-product.entity';
import {
  applyInventorySearchFilter,
  applyInventoryStatFilter,
  buildInventoryListFingerprint,
  buildInventoryStatsParameters,
  type InventoryShelfDateContext,
  INVENTORY_EXPIRED_SQL,
  INVENTORY_NEARING_EXPIRY_SQL,
  resolveInventoryShelfDateContext,
} from './inventory-list.utils';
import {
  buildInventorySearchDocument,
  mergeInventorySnapshot,
  normalizeInventorySearchValue,
  normalizeInventorySnapshot,
  toInventorySnapshotFromCreateDto,
} from './inventory-snapshot.utils';
import { assertValidInventoryDraft } from './inventory.validation';

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
    private readonly cataloguePhotoProcessorService: CataloguePhotoProcessorService,
    private readonly cataloguePhotoStorageService: CataloguePhotoStorageService,
  ) {}

  async list(
    userId: string,
    query: InventoryListQueryDto,
    savedTimeZone?: string | null,
    requestTimeZone?: string,
  ): Promise<PaginatedResult<InventoryProductResponseDto>> {
    const shelfDateContext = resolveInventoryShelfDateContext(
      savedTimeZone,
      requestTimeZone,
    );
    const fingerprint = buildInventoryListFingerprint(
      userId,
      query,
      shelfDateContext,
    );
    const queryBuilder = this.createListQueryBuilder(
      userId,
      query,
      shelfDateContext,
    );

    this.applySort(queryBuilder, query.sort);
    this.applyCursor(queryBuilder, query.sort, query.cursor, fingerprint);

    const entities = await queryBuilder.take(query.limit + 1).getMany();
    const hasMore = entities.length > query.limit;
    const pageEntities = hasMore ? entities.slice(0, query.limit) : entities;
    const items = pageEntities.map((product) => this.toResponseDto(product));
    const nextCursor = this.buildNextCursor(
      pageEntities.at(-1),
      query.sort,
      fingerprint,
      hasMore,
    );

    return { items, nextCursor };
  }

  async getStats(
    userId: string,
    savedTimeZone?: string | null,
    requestTimeZone?: string,
  ): Promise<Record<ShelfStatFilter, number>> {
    const shelfDateContext = resolveInventoryShelfDateContext(
      savedTimeZone,
      requestTimeZone,
    );

    return this.countStats(userId, shelfDateContext);
  }

  async getOne(
    userId: string,
    id: string,
  ): Promise<InventoryProductResponseDto> {
    const product = await this.findByIdOrFail(userId, id);
    return this.toResponseDto(product);
  }

  async create(
    userId: string,
    dto: CreateInventoryProductDto,
  ): Promise<InventoryProductResponseDto> {
    assertValidInventoryDraft(dto);
    const normalized = normalizeInventorySnapshot(
      toInventorySnapshotFromCreateDto(dto),
    );

    const entity = this.inventoryRepository.create(
      this.toEntityPayload(userId, this.normalizeManagedMediaRefs(normalized)),
    );
    const saved = await this.inventoryRepository.save(entity);
    return this.toResponseDto(saved);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateInventoryProductDto,
  ): Promise<InventoryProductResponseDto> {
    const product = await this.findByIdOrFail(userId, id);
    const merged = mergeInventorySnapshot(this.toSnapshot(product), dto);
    assertValidInventoryDraft(merged);
    const normalized = normalizeInventorySnapshot(merged);

    Object.assign(
      product,
      this.toEntityPayload(userId, this.normalizeManagedMediaRefs(normalized)),
    );
    const saved = await this.inventoryRepository.save(product);
    return this.toResponseDto(saved);
  }

  async uploadProductImage(file: UploadedCatalogueImage): Promise<string> {
    const processed =
      await this.cataloguePhotoProcessorService.prepareHeroImageForStorage(
        file,
      );
    const imageUrl =
      await this.cataloguePhotoStorageService.saveHeroImage(processed);

    if (!imageUrl) {
      throw new ServiceUnavailableException(
        'Product image storage is not configured',
      );
    }

    return imageUrl;
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
    return this.toResponseDto(saved);
  }

  private normalizeManagedMediaRefs(
    draft: ShelfProductSnapshot,
  ): ShelfProductSnapshot {
    return {
      ...draft,
      identity: {
        ...draft.identity,
        imageUrls: this.cataloguePhotoStorageService.toPersistentImageUrls(
          draft.identity.imageUrls,
        ),
      },
    };
  }

  private toResponseDto(entity: InventoryProduct): InventoryProductResponseDto {
    const response = InventoryProductResponseDto.fromEntity(entity);
    response.identity.imageUrls =
      this.cataloguePhotoStorageService.resolvePublicImageUrls(
        response.identity.imageUrls,
      );

    return response;
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
    shelfDateContext: InventoryShelfDateContext,
  ): SelectQueryBuilder<InventoryProduct> {
    const queryBuilder = this.inventoryRepository
      .createQueryBuilder('inventory')
      .where('inventory.user_id = :userId', { userId });

    applyInventoryStatFilter(queryBuilder, query.stat, shelfDateContext);

    if (query.category !== 'all') {
      queryBuilder.andWhere('inventory.category = :category', {
        category: query.category,
      });
    }

    applyInventorySearchFilter(
      queryBuilder,
      normalizeInventorySearchValue(query.search),
    );

    return queryBuilder;
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

  private async countStats(
    userId: string,
    shelfDateContext: InventoryShelfDateContext,
  ): Promise<Record<ShelfStatFilter, number>> {
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
            AND ${INVENTORY_NEARING_EXPIRY_SQL}
        )`,
        ShelfStatFilter.NearingExpiry,
      )
      .addSelect(
        `COUNT(*) FILTER (
          WHERE inventory.status != :archived
            AND inventory.opened_at IS NOT NULL
            AND inventory.effective_expires_at IS NOT NULL
            AND ${INVENTORY_EXPIRED_SQL}
        )`,
        ShelfStatFilter.Expired,
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE inventory.status = :archived)`,
        ShelfStatFilter.Archived,
      )
      .where('inventory.user_id = :userId', { userId })
      .setParameters(buildInventoryStatsParameters(shelfDateContext))
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
      provenance: DataProvenance.PhotoLookup,
    };
  }

  private toEntityPayload(
    userId: string,
    snapshot: ShelfProductSnapshot,
  ): Partial<InventoryProduct> {
    const effectiveExpiresAt = computeEffectiveExpiresAt(snapshot);
    const searchDocument = buildInventorySearchDocument(snapshot);

    return {
      user_id: userId,
      brand: snapshot.identity.brand,
      name: snapshot.identity.name,
      category: snapshot.identity.category,
      barcode: snapshot.identity.barcode,
      status: snapshot.status,
      provenance: snapshot.provenance,
      brand_search: normalizeInventorySearchValue(snapshot.identity.brand),
      name_search: normalizeInventorySearchValue(snapshot.identity.name),
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
