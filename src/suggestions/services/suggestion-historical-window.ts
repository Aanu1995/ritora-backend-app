import { toDateOnlyString } from '../../common/utils/date';

export const SUGGESTION_CONTEXT_HISTORY_DAYS = 30;
export const SUGGESTION_CONTEXT_BACKFILL_RECORDS = 30;

export function suggestionHistoryWindow(targetDate: string): {
  fromDate: string;
  toDate: string;
} {
  const toDate = toDateOnlyString(targetDate);
  const start = new Date(`${toDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (SUGGESTION_CONTEXT_HISTORY_DAYS - 1));
  return {
    fromDate: start.toISOString().slice(0, 10),
    toDate,
  };
}

export function suggestionHistoryWindowInstants(targetDate: string): {
  from: Date;
  to: Date;
} {
  const { fromDate, toDate } = suggestionHistoryWindow(targetDate);
  return {
    from: new Date(`${fromDate}T00:00:00.000Z`),
    to: new Date(`${toDate}T23:59:59.999Z`),
  };
}

export function mergeHistoryWindowWithBackfill<T>(
  windowRows: readonly T[],
  backfillRows: readonly T[],
  getId: (row: T) => string,
): T[] {
  if (windowRows.length >= SUGGESTION_CONTEXT_BACKFILL_RECORDS) {
    return [...windowRows];
  }
  const rows = [...windowRows];
  const seen = new Set(rows.map(getId));
  for (const row of backfillRows) {
    if (rows.length >= SUGGESTION_CONTEXT_BACKFILL_RECORDS) break;
    const id = getId(row);
    if (seen.has(id)) continue;
    rows.push(row);
    seen.add(id);
  }
  return rows;
}
