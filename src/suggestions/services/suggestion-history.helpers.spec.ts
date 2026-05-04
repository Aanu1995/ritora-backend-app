import { computeRange, shiftIsoDate } from './suggestion-history.helpers';

describe('suggestion history helpers', () => {
  it('builds default ranges ending at the supplied history end date', () => {
    expect(computeRange({ range: '7d' }, '2026-04-29')).toEqual({
      fromDate: '2026-04-23',
      toDate: '2026-04-29',
    });
    expect(computeRange({ range: '30d' }, '2026-04-29')).toEqual({
      fromDate: '2026-03-31',
      toDate: '2026-04-29',
    });
  });

  it('caps custom history ranges at the history end date', () => {
    expect(
      computeRange(
        {
          range: 'custom',
          from: '2026-04-28',
          to: '2026-05-01',
        },
        '2026-04-29',
      ),
    ).toEqual({
      fromDate: '2026-04-28',
      toDate: '2026-04-29',
    });
  });

  it('shifts ISO dates without local timezone drift', () => {
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});
