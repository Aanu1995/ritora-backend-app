import {
  Between,
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { RoutineBreak } from '../entities/routine-break.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionGenerationStatus } from '../suggestions.constants';
import {
  mergeHistoryWindowWithBackfill,
  SUGGESTION_CONTEXT_BACKFILL_RECORDS,
  SUGGESTION_CONTEXT_MAX_WINDOW_RECORDS,
  suggestionHistoryWindow,
  suggestionHistoryWindowInstants,
} from './suggestion-historical-window';

export type SuggestionHistoryLoadResult<T> = {
  rows: T[];
  windowRowCount: number;
  backfillRowCount: number;
};

export function emptySuggestionHistoryLoadResult<
  T,
>(): SuggestionHistoryLoadResult<T> {
  return {
    rows: [],
    windowRowCount: 0,
    backfillRowCount: 0,
  };
}

export async function loadSuggestionJournalHistory(
  journalRepo: Repository<SkinJournalEntry>,
  userId: string,
  targetDate: string,
): Promise<SuggestionHistoryLoadResult<SkinJournalEntry>> {
  const { fromDate, toDate } = suggestionHistoryWindow(targetDate);
  const windowRows = await journalRepo.find({
    where: { user_id: userId, entry_date: Between(fromDate, toDate) },
    order: { entry_date: 'DESC', updated_at: 'DESC' },
    take: SUGGESTION_CONTEXT_MAX_WINDOW_RECORDS,
  });
  const backfillRows =
    windowRows.length < SUGGESTION_CONTEXT_BACKFILL_RECORDS
      ? await journalRepo.find({
          where: { user_id: userId, entry_date: LessThan(fromDate) },
          order: { entry_date: 'DESC', updated_at: 'DESC' },
          take: SUGGESTION_CONTEXT_BACKFILL_RECORDS - windowRows.length,
        })
      : [];
  return buildHistoryLoadResult(windowRows, backfillRows, (entry) => entry.id);
}

export async function loadSuggestionApplicationHistory(
  applicationLogRepo: Repository<ApplicationLog>,
  userId: string,
  targetDate: string,
): Promise<SuggestionHistoryLoadResult<ApplicationLog>> {
  const { fromDate, toDate } = suggestionHistoryWindow(targetDate);
  const windowRows = await applicationLogRepo.find({
    where: { user_id: userId, target_date: Between(fromDate, toDate) },
    relations: ['items', 'items.product', 'items.substituted_with_product'],
    order: { target_date: 'DESC', created_at: 'DESC' },
    take: SUGGESTION_CONTEXT_MAX_WINDOW_RECORDS,
  });
  const backfillRows =
    windowRows.length < SUGGESTION_CONTEXT_BACKFILL_RECORDS
      ? await applicationLogRepo.find({
          where: { user_id: userId, target_date: LessThan(fromDate) },
          relations: [
            'items',
            'items.product',
            'items.substituted_with_product',
          ],
          order: { target_date: 'DESC', created_at: 'DESC' },
          take: SUGGESTION_CONTEXT_BACKFILL_RECORDS - windowRows.length,
        })
      : [];
  return buildHistoryLoadResult(windowRows, backfillRows, (log) => log.id);
}

export async function loadSuggestionInstanceHistory(
  suggestionRepo: Repository<SuggestionInstance>,
  userId: string,
  targetDate: string,
): Promise<SuggestionHistoryLoadResult<SuggestionInstance>> {
  const { fromDate, toDate } = suggestionHistoryWindow(targetDate);
  const windowRows = await suggestionRepo.find({
    where: {
      user_id: userId,
      target_date: Between(fromDate, toDate),
      generation_status: SuggestionGenerationStatus.Ready,
    },
    relations: ['steps', 'steps.product'],
    order: { target_date: 'DESC', target_time: 'DESC', created_at: 'DESC' },
    take: SUGGESTION_CONTEXT_MAX_WINDOW_RECORDS,
  });
  const backfillRows =
    windowRows.length < SUGGESTION_CONTEXT_BACKFILL_RECORDS
      ? await suggestionRepo.find({
          where: {
            user_id: userId,
            target_date: LessThan(fromDate),
            generation_status: SuggestionGenerationStatus.Ready,
          },
          relations: ['steps', 'steps.product'],
          order: {
            target_date: 'DESC',
            target_time: 'DESC',
            created_at: 'DESC',
          },
          take: SUGGESTION_CONTEXT_BACKFILL_RECORDS - windowRows.length,
        })
      : [];
  return buildHistoryLoadResult(
    windowRows,
    backfillRows,
    (suggestion) => suggestion.id,
  );
}

export async function loadSuggestionRoutineBreakHistory(
  routineBreakRepo: Repository<RoutineBreak>,
  userId: string,
  targetDate: string,
): Promise<SuggestionHistoryLoadResult<RoutineBreak>> {
  const { from, to } = suggestionHistoryWindowInstants(targetDate);
  const windowRows = await routineBreakRepo.find({
    where: [
      { user_id: userId, starts_at: Between(from, to) },
      {
        user_id: userId,
        starts_at: LessThan(from),
        ends_at: MoreThanOrEqual(from),
      },
      {
        user_id: userId,
        starts_at: LessThan(from),
        resumed_at: MoreThanOrEqual(from),
      },
      { user_id: userId, starts_at: LessThan(from), ends_at: IsNull() },
    ],
    order: { starts_at: 'DESC' },
    take: SUGGESTION_CONTEXT_MAX_WINDOW_RECORDS,
  });
  const backfillRows =
    windowRows.length < SUGGESTION_CONTEXT_BACKFILL_RECORDS
      ? await routineBreakRepo.find({
          where: {
            user_id: userId,
            starts_at: LessThan(from),
            ...(windowRows.length > 0
              ? { id: Not(In(windowRows.map((row) => row.id))) }
              : {}),
          },
          order: { starts_at: 'DESC' },
          take: SUGGESTION_CONTEXT_BACKFILL_RECORDS - windowRows.length,
        })
      : [];
  return buildHistoryLoadResult(
    windowRows,
    backfillRows,
    (breakRow) => breakRow.id,
  );
}

function buildHistoryLoadResult<T>(
  windowRows: T[],
  backfillRows: T[],
  getId: (row: T) => string,
): SuggestionHistoryLoadResult<T> {
  return {
    rows: mergeHistoryWindowWithBackfill(windowRows, backfillRows, getId),
    windowRowCount: windowRows.length,
    backfillRowCount: backfillRows.length,
  };
}
