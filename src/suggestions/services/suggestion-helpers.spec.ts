import {
  addDaysToDateString,
  buildSlotInstant,
  clampLeadTimeMinutes,
  clockTimesEqual,
  compareClockTimes,
  deriveSuggestionDaypart,
  endOfLocalDateInstant,
} from './suggestion-helpers';

describe('suggestion helpers', () => {
  it('clamps user-wide lead time to the product bounds', () => {
    expect(clampLeadTimeMinutes(5)).toBe(30);
    expect(clampLeadTimeMinutes(900)).toBe(720);
    expect(clampLeadTimeMinutes(121.4)).toBe(121);
    expect(clampLeadTimeMinutes(null)).toBe(120);
  });

  it('derives daypart from slot wall-clock time', () => {
    expect(deriveSuggestionDaypart('08:00')).toBe('morning');
    expect(deriveSuggestionDaypart('13:30')).toBe('noon');
    expect(deriveSuggestionDaypart('20:00')).toBe('evening');
  });

  it('compares database and API time shapes by wall-clock value', () => {
    expect(clockTimesEqual('12:30', '12:30:00')).toBe(true);
    expect(compareClockTimes('12:31:00', '12:30')).toBeGreaterThan(0);
    expect(compareClockTimes('12:29', '12:30:00')).toBeLessThan(0);
  });

  it('uses timezone-aware instants for DST-sensitive dates', () => {
    expect(
      buildSlotInstant('2026-03-29', '08:00', 'Europe/Stockholm').toISOString(),
    ).toBe('2026-03-29T06:00:00.000Z');
    expect(
      endOfLocalDateInstant('2026-03-29', 'Europe/Stockholm').toISOString(),
    ).toBe('2026-03-29T21:59:59.999Z');
  });

  it('accepts Date objects returned by raw database date columns', () => {
    expect(
      buildSlotInstant(
        new Date(2026, 4, 4, 0, 0, 0),
        '08:00',
        'Europe/Stockholm',
      ).toISOString(),
    ).toBe('2026-05-04T06:00:00.000Z');
  });

  describe('addDaysToDateString', () => {
    it('adds days across month and year boundaries', () => {
      expect(addDaysToDateString('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDaysToDateString('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('handles leap years', () => {
      expect(addDaysToDateString('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDaysToDateString('2028-02-29', 1)).toBe('2028-03-01');
    });

    it('advances one calendar day across DST fall-back dates', () => {
      // 2026-11-01 is a 25-hour day in America/New_York; calendar arithmetic
      // must still land on the next date.
      expect(addDaysToDateString('2026-11-01', 1)).toBe('2026-11-02');
    });

    it('returns the input unchanged when it is not a date string', () => {
      expect(addDaysToDateString('not-a-date', 1)).toBe('not-a-date');
    });
  });
});
