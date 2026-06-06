import { SuggestionHistoryLoadResult } from './suggestion-generation-history-loader';
import { SuggestionObservabilityService } from './suggestion-observability.service';

type HistoryMetrics = SuggestionHistoryLoadResult<unknown>;

export const SUGGESTION_CONTEXT_LOAD_DURATION_WARN_MS = 1_500;
export const SUGGESTION_CONTEXT_HISTORY_ROWS_WARN_THRESHOLD = 1_000;

export async function recordSuggestionContextLoad(input: {
  observability: SuggestionObservabilityService;
  userId: string;
  jobId: string;
  startedAtMs: number;
  sensitiveContextRead: boolean;
  journalHistory: HistoryMetrics;
  applicationHistory: HistoryMetrics;
  suggestionHistory: HistoryMetrics;
  routineBreakHistory: HistoryMetrics;
}): Promise<void> {
  const contextLoadDurationMs = Math.max(0, Date.now() - input.startedAtMs);
  const historyRowCounts = [
    input.journalHistory.rows.length,
    input.applicationHistory.rows.length,
    input.suggestionHistory.rows.length,
    input.routineBreakHistory.rows.length,
  ];
  const maxHistoryRows = Math.max(...historyRowCounts);
  await input.observability.record({
    kind: 'generation_context_loaded',
    userId: input.userId,
    jobId: input.jobId,
    metadata: {
      sensitiveContextRead: input.sensitiveContextRead,
      journalRows: input.journalHistory.rows.length,
      journalWindowRows: input.journalHistory.windowRowCount,
      journalBackfillRows: input.journalHistory.backfillRowCount,
      applicationRows: input.applicationHistory.rows.length,
      applicationWindowRows: input.applicationHistory.windowRowCount,
      applicationBackfillRows: input.applicationHistory.backfillRowCount,
      suggestionRows: input.suggestionHistory.rows.length,
      suggestionWindowRows: input.suggestionHistory.windowRowCount,
      suggestionBackfillRows: input.suggestionHistory.backfillRowCount,
      routineBreakRows: input.routineBreakHistory.rows.length,
      routineBreakWindowRows: input.routineBreakHistory.windowRowCount,
      routineBreakBackfillRows: input.routineBreakHistory.backfillRowCount,
      contextLoadDurationMs,
    },
  });
  const overDurationThreshold =
    contextLoadDurationMs > SUGGESTION_CONTEXT_LOAD_DURATION_WARN_MS;
  const overHistoryRowsThreshold =
    maxHistoryRows > SUGGESTION_CONTEXT_HISTORY_ROWS_WARN_THRESHOLD;
  if (!overDurationThreshold && !overHistoryRowsThreshold) return;
  await input.observability.record({
    kind: 'generation_context_threshold_exceeded',
    severity: 'warning',
    userId: input.userId,
    jobId: input.jobId,
    metadata: {
      contextLoadDurationMs,
      contextLoadDurationWarnMs: SUGGESTION_CONTEXT_LOAD_DURATION_WARN_MS,
      maxHistoryRows,
      historyRowsWarnThreshold: SUGGESTION_CONTEXT_HISTORY_ROWS_WARN_THRESHOLD,
      totalHistoryRows: historyRowCounts.reduce((sum, count) => sum + count, 0),
      overDurationThreshold,
      overHistoryRowsThreshold,
    },
  });
}
