import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(duration);

type DateLike = string | Date | dayjs.Dayjs;

function toDayjs(value: DateLike): dayjs.Dayjs {
  return dayjs.isDayjs(value) ? value.utc() : dayjs.utc(value);
}

export function parseUtcDate(
  value: string | Date | null | undefined,
): dayjs.Dayjs | null {
  if (!value) {
    return null;
  }

  const parsed = toDayjs(value);
  return parsed.isValid() ? parsed : null;
}

export function toDateOrNull(
  value: string | Date | null | undefined,
): Date | null {
  return parseUtcDate(value)?.toDate() ?? null;
}

export function toIsoString(value: DateLike): string {
  return toDayjs(value).toISOString();
}

export function toNullableIsoString(
  value: DateLike | null | undefined,
): string | null {
  return value ? toIsoString(value) : null;
}

export function toDateOnlyString(value: DateLike): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (dateOnly) return dateOnly;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return formatLocalDateOnly(parsed);
  }

  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return formatLocalDateOnly(value);
  }

  if (dayjs.isDayjs(value) && value.isValid()) {
    return value.format('YYYY-MM-DD');
  }

  throw new TypeError('Expected a valid date-only value.');
}

export function toTimeOnlyString(value: string | Date | dayjs.Dayjs): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const timeOnly = trimmed.match(/^(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1];
    if (timeOnly) return timeOnly;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return formatLocalTimeOnly(parsed);
  }

  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return formatLocalTimeOnly(value);
  }

  if (dayjs.isDayjs(value) && value.isValid()) {
    return value.format('HH:mm:ss');
  }

  throw new TypeError('Expected a valid time-only value.');
}

export function diffInDaysRounded(from: DateLike, to: DateLike): number {
  return Math.round(toDayjs(to).diff(toDayjs(from), 'day', true));
}

export function addMonths(value: DateLike, months: number): Date {
  return toDayjs(value).add(months, 'month').toDate();
}

export function nowUtc(): dayjs.Dayjs {
  return dayjs.utc();
}

export function nowDate(): Date {
  return nowUtc().toDate();
}

export function isBeforeNow(value: DateLike): boolean {
  return toDayjs(value).isBefore(nowUtc());
}

export function isAfterNow(value: DateLike): boolean {
  return toDayjs(value).isAfter(nowUtc());
}

export function expiresFromDuration(durationValue: string): Date {
  const match = durationValue.match(/^(\d+)([smhd])$/);
  if (!match) {
    return nowUtc().add(15, 'minute').toDate();
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return nowUtc().add(value, 'second').toDate();
    case 'm':
      return nowUtc().add(value, 'minute').toDate();
    case 'h':
      return nowUtc().add(value, 'hour').toDate();
    case 'd':
      return nowUtc().add(value, 'day').toDate();
    default:
      return nowUtc().add(15, 'minute').toDate();
  }
}

function formatLocalDateOnly(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatLocalTimeOnly(value: Date): string {
  return [
    String(value.getHours()).padStart(2, '0'),
    String(value.getMinutes()).padStart(2, '0'),
    String(value.getSeconds()).padStart(2, '0'),
  ].join(':');
}
