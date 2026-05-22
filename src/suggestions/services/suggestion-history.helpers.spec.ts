import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  buildSummaryLine,
  computeRange,
  computeSlotStatus,
  shiftIsoDate,
} from './suggestion-history.helpers';

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

  it('treats substitutions as completed but not exact applied matches', () => {
    const suggestion = {
      simplified_for_reaction: false,
      steps: [{ id: 'step-1' }, { id: 'step-2' }],
    } as SuggestionInstance;
    const log = {
      items: [{ status: 'applied' }, { status: 'substituted' }],
    } as ApplicationLog;

    expect(computeSlotStatus(suggestion, log)).toBe('partial');
    expect(buildSummaryLine(suggestion, log, 2, 2)).toBe(
      '2 of 2 used, with substitutions.',
    );
  });

  it('only marks a logged slot skipped when every suggested step was skipped', () => {
    const suggestion = {
      simplified_for_reaction: false,
      steps: [{ id: 'step-1' }, { id: 'step-2' }],
    } as SuggestionInstance;

    expect(
      computeSlotStatus(suggestion, {
        items: [{ status: 'substituted' }, { status: 'substituted' }],
      } as ApplicationLog),
    ).toBe('partial');
    expect(
      computeSlotStatus(suggestion, {
        items: [{ status: 'skipped' }, { status: 'skipped' }],
      } as ApplicationLog),
    ).toBe('skipped');
  });
});
