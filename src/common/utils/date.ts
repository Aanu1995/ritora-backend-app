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
