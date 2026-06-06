import { SuggestionObservabilityService } from './suggestion-observability.service';
import {
  recordSuggestionContextLoad,
  SUGGESTION_CONTEXT_HISTORY_ROWS_WARN_THRESHOLD,
  SUGGESTION_CONTEXT_LOAD_DURATION_WARN_MS,
} from './suggestion-context-load-observability';
import { SuggestionHistoryLoadResult } from './suggestion-generation-history-loader';

describe('recordSuggestionContextLoad', () => {
  const observability = {
    record: jest.fn(),
  } as unknown as jest.Mocked<SuggestionObservabilityService>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T08:00:01.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records warning monitoring when context load duration or row counts cross thresholds', async () => {
    const startedAtMs =
      Date.now() - SUGGESTION_CONTEXT_LOAD_DURATION_WARN_MS - 1;
    const largeHistory = history(
      SUGGESTION_CONTEXT_HISTORY_ROWS_WARN_THRESHOLD + 1,
    );

    await recordSuggestionContextLoad({
      observability,
      userId: 'user-1',
      jobId: 'job-1',
      startedAtMs,
      sensitiveContextRead: true,
      journalHistory: history(30),
      applicationHistory: largeHistory,
      suggestionHistory: history(30),
      routineBreakHistory: history(0),
    });

    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'generation_context_loaded',
        metadata: expect.objectContaining({
          applicationRows: SUGGESTION_CONTEXT_HISTORY_ROWS_WARN_THRESHOLD + 1,
          contextLoadDurationMs: SUGGESTION_CONTEXT_LOAD_DURATION_WARN_MS + 1,
        }),
      }),
    );
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'generation_context_threshold_exceeded',
        severity: 'warning',
        metadata: expect.objectContaining({
          contextLoadDurationMs: SUGGESTION_CONTEXT_LOAD_DURATION_WARN_MS + 1,
          contextLoadDurationWarnMs: SUGGESTION_CONTEXT_LOAD_DURATION_WARN_MS,
          maxHistoryRows: SUGGESTION_CONTEXT_HISTORY_ROWS_WARN_THRESHOLD + 1,
          historyRowsWarnThreshold:
            SUGGESTION_CONTEXT_HISTORY_ROWS_WARN_THRESHOLD,
          overDurationThreshold: true,
          overHistoryRowsThreshold: true,
        }),
      }),
    );
  });

  it('does not emit threshold warnings for normal context loads', async () => {
    await recordSuggestionContextLoad({
      observability,
      userId: 'user-1',
      jobId: 'job-1',
      startedAtMs: Date.now() - 100,
      sensitiveContextRead: false,
      journalHistory: history(0),
      applicationHistory: history(0),
      suggestionHistory: history(0),
      routineBreakHistory: history(5),
    });

    expect(observability.record).toHaveBeenCalledTimes(1);
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'generation_context_loaded',
        metadata: expect.objectContaining({
          sensitiveContextRead: false,
          routineBreakRows: 5,
        }),
      }),
    );
  });
});

function history(count: number): SuggestionHistoryLoadResult<unknown> {
  return {
    rows: Array.from({ length: count }, (_, index) => ({ id: `row-${index}` })),
    windowRowCount: count,
    backfillRowCount: 0,
  };
}
