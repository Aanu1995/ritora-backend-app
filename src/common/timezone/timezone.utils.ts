import { Temporal } from '@js-temporal/polyfill';
import { type DayOfWeek } from '../../schedule/dto/schedule.constants';

export const DEFAULT_TIME_ZONE = 'UTC';
const TIME_ZONE_CANONICALIZATION_LOCALE = 'en-US';
const RECURRING_OCCURRENCE_DISAMBIGUATION = 'compatible';

const OFFSET_TIME_ZONE_PATTERN = /^(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

export type TimeZoneResolutionSource = 'saved' | 'request' | 'default';

export type ResolvedTimeZoneContext = {
  timeZone: string;
  savedTimeZone: string | null;
  requestTimeZone: string | null;
  source: TimeZoneResolutionSource;
};

export type RecurringOccurrenceProjection = {
  ownerOccurrence: Temporal.ZonedDateTime;
  viewerOccurrence: Temporal.ZonedDateTime;
};

const TEMPORAL_DAY_TO_DAY_OF_WEEK: Record<number, DayOfWeek> = {
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
  7: 'sun',
};

const DAY_ORDER: Record<DayOfWeek, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

function isSupportedNamedTimeZone(timeZone: string): boolean {
  return (
    timeZone === DEFAULT_TIME_ZONE ||
    timeZone.includes('/') ||
    timeZone.startsWith('Etc/')
  );
}

function isOffsetTimeZone(value: string): boolean {
  return OFFSET_TIME_ZONE_PATTERN.test(value);
}

function resolveCanonicalTimeZone(value: string): string | null {
  try {
    const canonicalTimeZone = new Intl.DateTimeFormat(
      TIME_ZONE_CANONICALIZATION_LOCALE,
      {
        timeZone: value,
      },
    ).resolvedOptions().timeZone;

    return isSupportedNamedTimeZone(canonicalTimeZone)
      ? canonicalTimeZone
      : null;
  } catch {
    return null;
  }
}

function buildTimeZoneContext(
  timeZone: string,
  savedTimeZone: string | null,
  requestTimeZone: string | null,
  source: TimeZoneResolutionSource,
): ResolvedTimeZoneContext {
  return {
    timeZone,
    savedTimeZone,
    requestTimeZone,
    source,
  };
}

function resolveContextDayOfWeek(dayOfWeek: number): DayOfWeek {
  return TEMPORAL_DAY_TO_DAY_OF_WEEK[dayOfWeek];
}

function resolveRecurringCandidate(
  dayOfWeek: DayOfWeek,
  slotTime: string,
  timeZone: string,
  now: Temporal.Instant,
): Temporal.ZonedDateTime {
  const currentOccurrence = now.toZonedDateTimeISO(timeZone);
  const currentDay = resolveContextDayOfWeek(currentOccurrence.dayOfWeek);
  const daysUntilTarget =
    (DAY_ORDER[dayOfWeek] - DAY_ORDER[currentDay] + 7) % 7;

  return currentOccurrence
    .toPlainDate()
    .add({ days: daysUntilTarget })
    .toPlainDateTime(Temporal.PlainTime.from(slotTime))
    .toZonedDateTime(timeZone, {
      disambiguation: RECURRING_OCCURRENCE_DISAMBIGUATION,
    });
}

function resolveProjectionTimeZones(
  ownerTimeZone: string,
  viewerTimeZone: string,
): { ownerTimeZone: string; viewerTimeZone: string } {
  const canonicalOwnerTimeZone =
    canonicalizeTimeZone(ownerTimeZone) ?? DEFAULT_TIME_ZONE;
  const canonicalViewerTimeZone =
    canonicalizeTimeZone(viewerTimeZone) ?? canonicalOwnerTimeZone;

  return {
    ownerTimeZone: canonicalOwnerTimeZone,
    viewerTimeZone: canonicalViewerTimeZone,
  };
}

export function canonicalizeTimeZone(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || isOffsetTimeZone(trimmed)) {
    return null;
  }

  return resolveCanonicalTimeZone(trimmed);
}

export function resolveTimeZoneContext(
  savedTimeZone?: string | null,
  requestTimeZone?: string | null,
): ResolvedTimeZoneContext {
  const canonicalSavedTimeZone = canonicalizeTimeZone(savedTimeZone);
  const canonicalRequestTimeZone = canonicalizeTimeZone(requestTimeZone);

  if (canonicalSavedTimeZone) {
    return buildTimeZoneContext(
      canonicalSavedTimeZone,
      canonicalSavedTimeZone,
      canonicalRequestTimeZone,
      'saved',
    );
  }

  if (canonicalRequestTimeZone) {
    return buildTimeZoneContext(
      canonicalRequestTimeZone,
      null,
      canonicalRequestTimeZone,
      'request',
    );
  }

  return buildTimeZoneContext(DEFAULT_TIME_ZONE, null, null, 'default');
}

export function resolveEffectiveTimeZone(
  savedTimeZone?: string | null,
  requestTimeZone?: string | null,
): string {
  return resolveTimeZoneContext(savedTimeZone, requestTimeZone).timeZone;
}

export function resolveDayOfWeekForTimeZone(
  timeZone: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): DayOfWeek {
  return resolveContextDayOfWeek(now.toZonedDateTimeISO(timeZone).dayOfWeek);
}

export function resolveNextRecurringOccurrence(
  dayOfWeek: DayOfWeek,
  slotTime: string,
  timeZone: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): Temporal.ZonedDateTime {
  const currentOccurrence = now.toZonedDateTimeISO(timeZone);
  let candidate = resolveRecurringCandidate(dayOfWeek, slotTime, timeZone, now);

  if (Temporal.ZonedDateTime.compare(candidate, currentOccurrence) < 0) {
    candidate = candidate.add({ days: 7 });
  }

  return candidate;
}

export function resolveRecurringOccurrenceProjection(
  dayOfWeek: DayOfWeek,
  slotTime: string,
  ownerTimeZone: string,
  viewerTimeZone: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): RecurringOccurrenceProjection {
  const projectionTimeZones = resolveProjectionTimeZones(
    ownerTimeZone,
    viewerTimeZone,
  );

  const ownerOccurrence = resolveNextRecurringOccurrence(
    dayOfWeek,
    slotTime,
    projectionTimeZones.ownerTimeZone,
    now,
  );

  return {
    ownerOccurrence,
    viewerOccurrence: ownerOccurrence.withTimeZone(
      projectionTimeZones.viewerTimeZone,
    ),
  };
}
