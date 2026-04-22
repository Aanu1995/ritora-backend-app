import { Temporal } from '@js-temporal/polyfill';
import {
  canonicalizeTimeZone,
  DEFAULT_TIME_ZONE,
  resolveDayOfWeekForTimeZone,
  resolveEffectiveTimeZone,
  resolveRecurringOccurrenceProjection,
  resolveNextRecurringOccurrence,
  resolveTimeZoneContext,
} from './timezone.utils';

describe('timezone.utils', () => {
  it('canonicalizes valid IANA zones and rejects raw offsets', () => {
    expect(canonicalizeTimeZone(' Europe/Stockholm ')).toBe('Europe/Stockholm');
    expect(canonicalizeTimeZone('+01:00')).toBeNull();
    expect(canonicalizeTimeZone('not-a-zone')).toBeNull();
  });

  it('prefers the saved timezone over the request header', () => {
    expect(
      resolveEffectiveTimeZone('Europe/Stockholm', 'America/New_York'),
    ).toBe('Europe/Stockholm');
    expect(resolveEffectiveTimeZone(null, null)).toBe(DEFAULT_TIME_ZONE);
  });

  it('returns timezone context metadata for future projections', () => {
    expect(
      resolveTimeZoneContext('Europe/Stockholm', 'America/New_York'),
    ).toEqual({
      timeZone: 'Europe/Stockholm',
      savedTimeZone: 'Europe/Stockholm',
      requestTimeZone: 'America/New_York',
      source: 'saved',
    });

    expect(resolveTimeZoneContext(null, null)).toEqual({
      timeZone: DEFAULT_TIME_ZONE,
      savedTimeZone: null,
      requestTimeZone: null,
      source: 'default',
    });
  });

  it('resolves the weekday in the authoritative timezone', () => {
    const instant = Temporal.Instant.from('2026-04-22T00:30:00Z');

    expect(resolveDayOfWeekForTimeZone('Europe/Stockholm', instant)).toBe(
      'wed',
    );
    expect(resolveDayOfWeekForTimeZone('America/Los_Angeles', instant)).toBe(
      'tue',
    );
  });

  it('projects recurring local times through DST with compatible disambiguation', () => {
    const springForwardInstant = Temporal.Instant.from('2026-03-28T23:30:00Z');

    const occurrence = resolveNextRecurringOccurrence(
      'sun',
      '02:30:00',
      'Europe/Stockholm',
      springForwardInstant,
    );

    expect(occurrence.dayOfWeek).toBe(7);
    expect(occurrence.timeZoneId).toBe('Europe/Stockholm');
    expect(occurrence.hour).toBe(3);
    expect(occurrence.minute).toBe(30);
  });

  it('projects owner-anchored occurrences into a viewer timezone for sharing', () => {
    const instant = Temporal.Instant.from('2026-04-20T05:00:00Z');

    const projection = resolveRecurringOccurrenceProjection(
      'mon',
      '08:00:00',
      'Europe/Stockholm',
      'America/New_York',
      instant,
    );

    expect(projection.ownerOccurrence.timeZoneId).toBe('Europe/Stockholm');
    expect(projection.ownerOccurrence.hour).toBe(8);
    expect(projection.viewerOccurrence.timeZoneId).toBe('America/New_York');
    expect(projection.viewerOccurrence.hour).toBe(2);
  });
});
