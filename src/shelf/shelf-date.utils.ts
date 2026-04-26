import { Temporal } from '@js-temporal/polyfill';
import { parseUtcDate } from '../common/utils/date';
import { DEFAULT_TIME_ZONE } from '../common/timezone/timezone.utils';

export type ShelfNowInput = Date | string | Temporal.Instant;

function resolveStoredDateKey(
  value: string | Date | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const parsed = parseUtcDate(value);
  return parsed ? parsed.format('YYYY-MM-DD') : null;
}

function resolveInstant(now: ShelfNowInput | undefined): Temporal.Instant {
  if (!now) {
    return Temporal.Now.instant();
  }

  if (now instanceof Date) {
    return Temporal.Instant.from(now.toISOString());
  }

  return typeof now === 'string' ? Temporal.Instant.from(now) : now;
}

export function parseShelfPlainDate(
  value: string | Date | null | undefined,
): Temporal.PlainDate | null {
  const dateKey = resolveStoredDateKey(value);
  return dateKey ? Temporal.PlainDate.from(dateKey) : null;
}

export function resolveShelfToday(
  timeZone: string = DEFAULT_TIME_ZONE,
  now?: ShelfNowInput,
): Temporal.PlainDate {
  return resolveInstant(now).toZonedDateTimeISO(timeZone).toPlainDate();
}

export function diffShelfCalendarDays(
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
): number {
  return from.until(to, { largestUnit: 'day' }).days;
}

export function toShelfStoredUtcDate(date: Temporal.PlainDate): Date {
  return new Date(`${date.toString()}T00:00:00.000Z`);
}
