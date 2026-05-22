import {
  isValidDate,
  monthRange,
  parsePeriodLabelToRangeOrThrow,
  resolveSkinJournalTimeZone,
  todayInTimeZone,
} from './skin-journal.utils';

describe('skin-journal utils', () => {
  it('validates real calendar dates only', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-31')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
  });

  it('falls back to UTC for invalid timezone input', () => {
    expect(resolveSkinJournalTimeZone('Not/AZone')).toBe('UTC');
    expect(() => todayInTimeZone('Not/AZone')).not.toThrow();
  });

  it('returns month ranges for valid YYYY-MM labels', () => {
    expect(monthRange('2026-02')).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
    expect(monthRange('2028-02')).toEqual({
      start: '2028-02-01',
      end: '2028-02-29',
    });
  });

  it('throws BadRequestException for invalid wrapped period labels', () => {
    expect(() => parsePeriodLabelToRangeOrThrow('monthly', '2026-13')).toThrow(
      'Monthly label must be YYYY-MM',
    );
    expect(() =>
      parsePeriodLabelToRangeOrThrow('quarterly', '2026-Q5'),
    ).toThrow('Quarterly label must be YYYY-Qn');
    expect(() => parsePeriodLabelToRangeOrThrow('yearly', '20x6')).toThrow(
      'Yearly label must be YYYY',
    );
  });
});
