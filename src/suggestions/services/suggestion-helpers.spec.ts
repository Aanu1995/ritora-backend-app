import {
  buildSlotInstant,
  clampLeadTimeMinutes,
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
});
