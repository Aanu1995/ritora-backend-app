import dayjs from 'dayjs';
import {
  diffInDaysRounded,
  expiresFromDuration,
  parseUtcDate,
  toDateOnlyString,
  toDateOrNull,
  toIsoString,
  toNullableIsoString,
  toTimeOnlyString,
} from './date';

describe('date-only normalization', () => {
  it('preserves SQL date semantics when a date column is returned as a Date object', () => {
    expect(toDateOnlyString(new Date(2026, 4, 4, 0, 0, 0))).toBe('2026-05-04');
  });

  it('normalizes ISO timestamp strings to date-only strings', () => {
    expect(toDateOnlyString('2026-05-04T22:10:00.000Z')).toBe('2026-05-04');
  });

  it('normalizes Date-backed time values to SQL time strings', () => {
    expect(toTimeOnlyString(new Date(2026, 4, 4, 8, 5, 7))).toBe('08:05:07');
  });

  it('parses valid UTC dates and rejects empty or invalid values', () => {
    expect(parseUtcDate('2026-05-04T10:00:00.000Z')?.toISOString()).toBe(
      '2026-05-04T10:00:00.000Z',
    );
    expect(toDateOrNull('2026-05-04T10:00:00.000Z')?.toISOString()).toBe(
      '2026-05-04T10:00:00.000Z',
    );
    expect(parseUtcDate(null)).toBeNull();
    expect(parseUtcDate(undefined)).toBeNull();
    expect(parseUtcDate('not-a-date')).toBeNull();
    expect(toDateOrNull('not-a-date')).toBeNull();
  });

  it('normalizes nullable and Dayjs-backed date values', () => {
    const value = dayjs.utc('2026-05-04T10:05:00.000Z');

    expect(toIsoString(value)).toBe('2026-05-04T10:05:00.000Z');
    expect(toNullableIsoString(value)).toBe('2026-05-04T10:05:00.000Z');
    expect(toNullableIsoString(null)).toBeNull();
    expect(toDateOnlyString(value)).toBe('2026-05-04');
    expect(toTimeOnlyString(value)).toBe('10:05:00');
  });

  it('throws on invalid date-only and time-only values', () => {
    expect(() => toDateOnlyString('not-a-date')).toThrow(TypeError);
    expect(() => toDateOnlyString(new Date(Number.NaN))).toThrow(TypeError);
    expect(() => toDateOnlyString(dayjs('not-a-date'))).toThrow(TypeError);
    expect(() => toTimeOnlyString('not-a-time')).toThrow(TypeError);
    expect(() => toTimeOnlyString(new Date(Number.NaN))).toThrow(TypeError);
    expect(() => toTimeOnlyString(dayjs('not-a-date'))).toThrow(TypeError);
  });

  it('computes rounded day differences and duration-based expiry dates', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T10:00:00.000Z'));

    expect(
      diffInDaysRounded('2026-05-01T22:00:00.000Z', '2026-05-04T10:00:00.000Z'),
    ).toBe(3);
    expect(expiresFromDuration('30s').toISOString()).toBe(
      '2026-05-04T10:00:30.000Z',
    );
    expect(expiresFromDuration('15m').toISOString()).toBe(
      '2026-05-04T10:15:00.000Z',
    );
    expect(expiresFromDuration('2h').toISOString()).toBe(
      '2026-05-04T12:00:00.000Z',
    );
    expect(expiresFromDuration('3d').toISOString()).toBe(
      '2026-05-07T10:00:00.000Z',
    );
    expect(expiresFromDuration('bad').toISOString()).toBe(
      '2026-05-04T10:15:00.000Z',
    );

    jest.useRealTimers();
  });
});
