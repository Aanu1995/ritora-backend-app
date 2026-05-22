import { BadRequestException } from '@nestjs/common';
import { Brackets, SelectQueryBuilder } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import {
  decodeCursor,
  encodeCursor,
} from '../../common/utils/cursor-pagination';
import { SuggestionHistoryListQueryDto } from '../dto/suggestion-history.dto';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT,
  SUGGESTION_HISTORY_PAGE_MAX_LIMIT,
  SuggestionHistorySlotStatus,
} from '../suggestions.constants';

type HistoryCursorTuple = [string, string, string];

export type HistoryCursorRow = {
  suggestion_id: string;
  target_date: string | Date;
  target_time: string | Date;
};

type HistoryFingerprintInput = Pick<
  SuggestionHistoryListQueryDto,
  'daypart' | 'mode' | 'requestSource' | 'status' | 'edited' | 'limit'
> & {
  fromDate: string;
  toDate: string;
};

const HISTORY_CURSOR_FINGERPRINT_PREFIX = 'suggestions-history:v1';
const HISTORY_STEP_COUNT_SQL = `(SELECT COUNT(*) FROM suggestion_steps step WHERE step.suggestion_instance_id = suggestion.id)`;
const HISTORY_APPLIED_COUNT_SQL = `(
  SELECT COUNT(*)
  FROM application_log_items item
  INNER JOIN application_logs log ON log.id = item.application_log_id
  WHERE log.suggestion_instance_id = suggestion.id
    AND log.user_id = :userId
    AND item.status = 'applied'
)`;
const HISTORY_COMPLETED_COUNT_SQL = `(
  SELECT COUNT(*)
  FROM application_log_items item
  INNER JOIN application_logs log ON log.id = item.application_log_id
  WHERE log.suggestion_instance_id = suggestion.id
    AND log.user_id = :userId
    AND item.status != 'skipped'
)`;
const HISTORY_LOG_EXISTS_SQL = `EXISTS (
  SELECT 1 FROM application_logs log
  WHERE log.suggestion_instance_id = suggestion.id
    AND log.user_id = :userId
)`;
const HISTORY_EDITED_LOG_EXISTS_SQL = `EXISTS (
  SELECT 1 FROM application_logs log
  WHERE log.suggestion_instance_id = suggestion.id
    AND log.user_id = :userId
    AND log.has_been_edited = true
)`;

export function applyHistoryFilters(
  queryBuilder: SelectQueryBuilder<SuggestionInstance>,
  query: SuggestionHistoryListQueryDto,
  userId: string,
): void {
  queryBuilder.setParameter('userId', userId);
  if (query.daypart) {
    queryBuilder.andWhere('suggestion.daypart = :daypart', {
      daypart: query.daypart,
    });
  }
  if (query.mode) {
    queryBuilder.andWhere('suggestion.mode = :mode', { mode: query.mode });
  }
  if (query.requestSource) {
    queryBuilder.andWhere('suggestion.request_source = :requestSource', {
      requestSource: query.requestSource,
    });
  }
  if (query.edited === true) {
    queryBuilder.andWhere(HISTORY_EDITED_LOG_EXISTS_SQL);
  } else if (query.edited === false) {
    queryBuilder.andWhere(`NOT ${HISTORY_EDITED_LOG_EXISTS_SQL}`);
  }
  if (query.status) {
    queryBuilder.andWhere(historyStatusSql(query.status));
  }
}

export function applyHistoryCursor(
  queryBuilder: SelectQueryBuilder<SuggestionInstance>,
  cursor: string | undefined,
  fingerprint: string,
): void {
  if (!cursor) return;
  const decoded = decodeCursor(cursor);
  if (decoded.fingerprint !== fingerprint) {
    throw new BadRequestException('Cursor does not match this request');
  }
  const [targetDate, targetTime, id] = decoded.tuple;
  if (
    typeof targetDate !== 'string' ||
    typeof targetTime !== 'string' ||
    typeof id !== 'string'
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  queryBuilder.andWhere(
    new Brackets((qb) => {
      qb.where('suggestion.target_date < :cursorTargetDate', {
        cursorTargetDate: targetDate,
      })
        .orWhere(
          'suggestion.target_date = :cursorTargetDate AND suggestion.target_time < :cursorTargetTime',
          { cursorTargetDate: targetDate, cursorTargetTime: targetTime },
        )
        .orWhere(
          'suggestion.target_date = :cursorTargetDate AND suggestion.target_time = :cursorTargetTime AND suggestion.id < :cursorId',
          {
            cursorTargetDate: targetDate,
            cursorTargetTime: targetTime,
            cursorId: id,
          },
        );
    }),
  );
}

export function buildHistoryNextCursor(
  row: HistoryCursorRow | undefined,
  fingerprint: string,
  hasMore: boolean,
): string | null {
  if (!hasMore || !row) return null;
  return encodeCursor({ fingerprint, tuple: historyCursorTuple(row) });
}

export function historyCursorFingerprint(
  userId: string,
  query: HistoryFingerprintInput,
): string {
  return [
    HISTORY_CURSOR_FINGERPRINT_PREFIX,
    userId,
    query.fromDate,
    query.toDate,
    query.daypart ?? '',
    query.mode ?? '',
    query.requestSource ?? '',
    query.status ?? '',
    query.edited === undefined ? '' : String(query.edited),
    clampHistoryLimit(query.limit),
  ].join(':');
}

export function clampHistoryLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    return SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(limit, SUGGESTION_HISTORY_PAGE_MAX_LIMIT));
}

function historyCursorTuple(row: HistoryCursorRow): HistoryCursorTuple {
  return [
    toDateOnlyString(row.target_date),
    toTimeOnlyString(row.target_time),
    row.suggestion_id,
  ];
}

function historyStatusSql(status: SuggestionHistorySlotStatus): string {
  switch (status) {
    case SuggestionHistorySlotStatus.Simplified:
      return 'suggestion.simplified_for_reaction = true';
    case SuggestionHistorySlotStatus.Missed:
      return `suggestion.simplified_for_reaction = false AND (NOT ${HISTORY_LOG_EXISTS_SQL} OR ${HISTORY_STEP_COUNT_SQL} = 0)`;
    case SuggestionHistorySlotStatus.Applied:
      return `suggestion.simplified_for_reaction = false AND ${HISTORY_STEP_COUNT_SQL} > 0 AND ${HISTORY_APPLIED_COUNT_SQL} = ${HISTORY_STEP_COUNT_SQL}`;
    case SuggestionHistorySlotStatus.Skipped:
      return `suggestion.simplified_for_reaction = false AND ${HISTORY_STEP_COUNT_SQL} > 0 AND ${HISTORY_LOG_EXISTS_SQL} AND ${HISTORY_COMPLETED_COUNT_SQL} = 0`;
    case SuggestionHistorySlotStatus.Partial:
      return `suggestion.simplified_for_reaction = false AND ${HISTORY_STEP_COUNT_SQL} > 0 AND ${HISTORY_COMPLETED_COUNT_SQL} > 0 AND ${HISTORY_APPLIED_COUNT_SQL} < ${HISTORY_STEP_COUNT_SQL}`;
  }
}
