import { Temporal } from '@js-temporal/polyfill';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import {
  DAYPART_BOUNDARY_EVENING_MINUTES,
  DAYPART_BOUNDARY_NOON_MINUTES,
  SuggestionDaypart,
} from '../suggestions.constants';

/** Bucket a HH:MM[:SS] slot time into morning, noon (mid-day), or evening. */
export function deriveSuggestionDaypart(slotTime: string): SuggestionDaypart {
  const total = clockTimeToSeconds(slotTime) / 60;
  if (total < DAYPART_BOUNDARY_NOON_MINUTES) return SuggestionDaypart.Morning;
  if (total < DAYPART_BOUNDARY_EVENING_MINUTES) return SuggestionDaypart.Noon;
  return SuggestionDaypart.Evening;
}

export function clockTimesEqual(
  first: string | Date,
  second: string | Date,
): boolean {
  return compareClockTimes(first, second) === 0;
}

export function compareClockTimes(
  first: string | Date,
  second: string | Date,
): number {
  return clockTimeToSeconds(first) - clockTimeToSeconds(second);
}

export function clockTimeToSeconds(value: string | Date): number {
  const normalized = toTimeOnlyString(value);
  const [hourStr = '0', minuteStr = '0', secondStr = '0'] =
    normalized.split(':');
  const hours = Number.parseInt(hourStr, 10);
  const minutes = Number.parseInt(minuteStr, 10);
  const seconds = Number.parseInt(secondStr, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return 0;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Compute the wall-clock instant of a slot on a given calendar date in a
 * specific time zone. Used to derive `visible_at` and to know when a slot
 * has started.
 */
export function buildSlotInstant(
  targetDate: string | Date,
  slotTime: string | Date,
  timeZone: string,
): Date {
  const normalizedTargetDate = toDateOnlyString(targetDate);
  const normalizedSlotTime = toTimeOnlyString(slotTime);
  try {
    const plainDate = Temporal.PlainDate.from(normalizedTargetDate);
    const plainTime = Temporal.PlainTime.from(
      normalizeTemporalTime(normalizedSlotTime),
    );
    return new Date(
      plainDate.toPlainDateTime(plainTime).toZonedDateTime(timeZone)
        .epochMilliseconds,
    );
  } catch {
    const [yearStr = '1970', monthStr = '01', dayStr = '01'] =
      normalizedTargetDate.split('-');
    const [hourStr = '0', minuteStr = '0', secondStr = '0'] =
      normalizedSlotTime.split(':');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hours = Number(hourStr);
    const minutes = Number(minuteStr);
    const seconds = Number(secondStr) || 0;

    const utc = Date.UTC(year, month - 1, day, hours, minutes, seconds);
    const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, new Date(utc));
    return new Date(utc - offsetMinutes * 60_000);
  }
}

/**
 * Returns the time-zone offset in minutes for a given instant. Positive
 * offsets are east of UTC.
 */
export function getTimeZoneOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(at);
    const lookup = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');
    const asUtc = Date.UTC(
      lookup('year'),
      lookup('month') - 1,
      lookup('day'),
      lookup('hour'),
      lookup('minute'),
      lookup('second'),
    );
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/** Format a `Date` as a YYYY-MM-DD string in the given time zone. */
export function formatDateInTimeZone(timeZone: string, at: Date): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * Add whole days to a YYYY-MM-DD string using calendar arithmetic. Unlike
 * adding 24h of milliseconds to an instant, this stays correct across DST
 * transitions (23/25-hour days).
 */
export function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return date;
  }
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function formatTimeInTimeZone(timeZone: string, at: Date): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

export function clampLeadTimeMinutes(
  value: number | null | undefined,
  defaultValue = 120,
  min = 30,
  max = 720,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function endOfLocalDateInstant(
  targetDate: string | Date,
  timeZone: string,
): Date {
  const normalizedTargetDate = toDateOnlyString(targetDate);
  try {
    const nextDay = Temporal.PlainDate.from(normalizedTargetDate).add({
      days: 1,
    });
    return new Date(
      nextDay
        .toPlainDateTime(Temporal.PlainTime.from('00:00'))
        .toZonedDateTime(timeZone).epochMilliseconds - 1,
    );
  } catch {
    return new Date(`${normalizedTargetDate}T23:59:59.999Z`);
  }
}

function normalizeTemporalTime(slotTime: string): string {
  const [hours = '00', minutes = '00', seconds = '00'] = slotTime.split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(
    2,
    '0',
  )}`;
}
