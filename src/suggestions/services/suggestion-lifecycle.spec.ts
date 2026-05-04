import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { computeSuggestionLifecycle } from './suggestion-lifecycle';

describe('computeSuggestionLifecycle', () => {
  const base = {
    targetDate: '2026-04-29',
    slotTime: '08:00',
    visibleAt: new Date('2026-04-29T06:00:00.000Z'),
    timeZone: 'UTC',
  };

  it('keeps future slots locked before the lead-time window', () => {
    const lifecycle = computeSuggestionLifecycle({
      ...base,
      now: new Date('2026-04-29T05:59:00.000Z'),
      suggestion: null,
      applicationLog: null,
    });

    expect(lifecycle.status).toBe('locked');
  });

  it('moves through ready, active, and recordable around the slot time', () => {
    const suggestion = suggestionWithStatus('ready');

    expect(
      computeSuggestionLifecycle({
        ...base,
        suggestion,
        applicationLog: null,
        now: new Date('2026-04-29T06:30:00.000Z'),
      }).status,
    ).toBe('ready');
    expect(
      computeSuggestionLifecycle({
        ...base,
        suggestion,
        applicationLog: null,
        now: new Date('2026-04-29T08:00:00.000Z'),
      }).status,
    ).toBe('active');
    expect(
      computeSuggestionLifecycle({
        ...base,
        suggestion,
        applicationLog: null,
        now: new Date('2026-04-29T08:31:00.000Z'),
      }).status,
    ).toBe('recordable');
  });

  it('lets recorded and edited states override time-based status', () => {
    const suggestion = suggestionWithStatus('ready');

    expect(
      computeSuggestionLifecycle({
        ...base,
        suggestion,
        applicationLog: applicationLog(false),
        now: new Date('2026-04-29T09:00:00.000Z'),
      }).status,
    ).toBe('recorded');
    expect(
      computeSuggestionLifecycle({
        ...base,
        suggestion,
        applicationLog: applicationLog(true),
        now: new Date('2026-04-29T09:00:00.000Z'),
      }).status,
    ).toBe('edited');
  });

  it('marks unrecorded past-day slots missed', () => {
    const lifecycle = computeSuggestionLifecycle({
      ...base,
      suggestion: suggestionWithStatus('ready'),
      applicationLog: null,
      now: new Date('2026-04-30T00:00:00.000Z'),
    });

    expect(lifecycle.status).toBe('missed');
  });
});

function suggestionWithStatus(
  generationStatus: SuggestionInstance['generation_status'],
): SuggestionInstance {
  return {
    generation_status: generationStatus,
  } as SuggestionInstance;
}

function applicationLog(hasBeenEdited: boolean): ApplicationLog {
  return {
    has_been_edited: hasBeenEdited,
  } as ApplicationLog;
}
