import { SelectQueryBuilder } from 'typeorm';
import { resolveEffectiveTimeZone } from '../common/timezone/timezone.utils';
import { toIsoString } from '../common/utils/date';
import {
  resolveShelfToday,
  toShelfStoredUtcDate,
} from '../shelf/shelf-date.utils';
import { ShelfStatFilter, ShelfStatus } from '../shelf/shelf.types';
import { InventoryListQueryDto } from './dto/inventory-list-query.dto';
import { InventoryProduct } from './entities/inventory-product.entity';
import { normalizeInventorySearchValue } from './inventory-snapshot.utils';

export type InventoryShelfDateContext = {
  effectiveTimeZone: string;
  todayDate: string;
  todayStartUtc: string;
};

type InventoryStatFilterParams = {
  active: ShelfStatus.Active;
  archived: ShelfStatus.Archived;
  todayStartUtc: string;
};

export const INVENTORY_EXPIRED_SQL =
  'inventory.effective_expires_at <= :todayStartUtc';
export const INVENTORY_NEARING_EXPIRY_SQL = `(${INVENTORY_EXPIRED_SQL} OR :todayStartUtc >= inventory.opened_at + ((inventory.effective_expires_at - inventory.opened_at) / 2.0))`;

function buildInventoryStatFilterParams(
  shelfDateContext: InventoryShelfDateContext,
): InventoryStatFilterParams {
  return {
    active: ShelfStatus.Active,
    archived: ShelfStatus.Archived,
    todayStartUtc: shelfDateContext.todayStartUtc,
  };
}

export function isInventoryListDateSensitive(stat: ShelfStatFilter): boolean {
  return (
    stat === ShelfStatFilter.Expired || stat === ShelfStatFilter.NearingExpiry
  );
}

export function resolveInventoryShelfDateContext(
  savedTimeZone?: string | null,
  requestTimeZone?: string,
): InventoryShelfDateContext {
  const effectiveTimeZone = resolveEffectiveTimeZone(
    savedTimeZone,
    requestTimeZone,
  );
  const today = resolveShelfToday(effectiveTimeZone);

  return {
    effectiveTimeZone,
    todayDate: today.toString(),
    todayStartUtc: toIsoString(toShelfStoredUtcDate(today)),
  };
}

export function buildInventoryListFingerprint(
  userId: string,
  query: InventoryListQueryDto,
  shelfDateContext: InventoryShelfDateContext,
): string {
  const fingerprint = [
    'inventory',
    userId,
    query.stat,
    query.category,
    normalizeInventorySearchValue(query.search),
    query.sort,
    query.limit,
  ];

  if (isInventoryListDateSensitive(query.stat)) {
    fingerprint.push(
      shelfDateContext.effectiveTimeZone,
      shelfDateContext.todayDate,
    );
  }

  return fingerprint.join(':');
}

export function applyInventorySearchFilter(
  queryBuilder: SelectQueryBuilder<InventoryProduct>,
  normalizedSearch: string,
) {
  if (!normalizedSearch) {
    return;
  }

  queryBuilder.andWhere('inventory.search_document LIKE :searchLike', {
    searchLike: `%${normalizedSearch}%`,
  });
}

export function applyInventoryStatFilter(
  queryBuilder: SelectQueryBuilder<InventoryProduct>,
  stat: ShelfStatFilter,
  shelfDateContext: InventoryShelfDateContext,
) {
  const params = buildInventoryStatFilterParams(shelfDateContext);

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
        .andWhere(INVENTORY_EXPIRED_SQL, params);
      return;
    case ShelfStatFilter.NearingExpiry:
      queryBuilder
        .andWhere('inventory.status != :archived', params)
        .andWhere('inventory.opened_at IS NOT NULL')
        .andWhere('inventory.effective_expires_at IS NOT NULL')
        .andWhere(INVENTORY_NEARING_EXPIRY_SQL, params);
      return;
    case ShelfStatFilter.All:
    default:
      queryBuilder.andWhere('inventory.status != :archived', params);
  }
}

export function buildInventoryStatsParameters(
  shelfDateContext: InventoryShelfDateContext,
): InventoryStatFilterParams {
  return buildInventoryStatFilterParams(shelfDateContext);
}
