import { toDateOnlyString, toTimeOnlyString } from './date';

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
});
