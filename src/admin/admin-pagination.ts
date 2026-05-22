import { type AdminPaginationMeta } from './admin.types';

const DEFAULT_MAX_PAGE = 10_000;

type NormalizePaginationOptions = {
  defaultLimit: number;
  limit?: number;
  maxLimit: number;
  maxPage?: number;
  page?: number;
};

type NormalizedPagination = {
  limit: number;
  offset: number;
  page: number;
};

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(Math.floor(value), 1);
}

export function normalizePagination({
  defaultLimit,
  limit,
  maxLimit,
  maxPage = DEFAULT_MAX_PAGE,
  page,
}: NormalizePaginationOptions): NormalizedPagination {
  const normalizedLimit = Math.min(
    normalizePositiveInteger(limit, defaultLimit),
    maxLimit,
  );
  const normalizedPage = Math.min(normalizePositiveInteger(page, 1), maxPage);

  return {
    limit: normalizedLimit,
    offset: (normalizedPage - 1) * normalizedLimit,
    page: normalizedPage,
  };
}

export function buildPaginationMeta(
  total: number,
  pagination: NormalizedPagination,
): AdminPaginationMeta {
  const safeTotal = Math.max(Math.floor(total), 0);
  const totalPages =
    safeTotal === 0 ? 0 : Math.ceil(safeTotal / pagination.limit);

  return {
    hasNextPage: totalPages > 0 && pagination.page < totalPages,
    hasPreviousPage: totalPages > 0 && pagination.page > 1,
    limit: pagination.limit,
    page: pagination.page,
    total: safeTotal,
    totalPages,
  };
}
