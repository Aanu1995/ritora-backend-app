import { FindOptionsWhere, QueryDeepPartialEntity, Repository } from 'typeorm';
import { ulid } from 'ulid';
import { isPostgresUniqueConstraintError } from '../../common/utils/database-errors';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import {
  SuggestionGenerationJobStatus,
  SuggestionRequestSource,
} from '../suggestions.constants';
import { clockTimesEqual } from './suggestion-helpers';

type BaseSuggestionGenerationJobDraft = Pick<
  SuggestionGenerationJob,
  | 'user_id'
  | 'slot_id'
  | 'target_date'
  | 'target_time'
  | 'visible_at'
  | 'status'
  | 'attempt_count'
  | 'run_after'
  | 'last_error'
>;

export type SuggestionGenerationJobDraft = BaseSuggestionGenerationJobDraft & {
  suggestion_instance_id?: string | null;
  request_source?: SuggestionRequestSource;
};

export async function insertSuggestionGenerationJob(
  repo: Repository<SuggestionGenerationJob>,
  draft: SuggestionGenerationJobDraft,
): Promise<boolean> {
  try {
    await repo.insert(buildJobRow(draft));
    return true;
  } catch (error) {
    if (isPostgresUniqueConstraintError(error)) return false;
    throw error;
  }
}

export async function requeueSuggestionGenerationJob(
  repo: Repository<SuggestionGenerationJob>,
  draft: SuggestionGenerationJobDraft,
): Promise<boolean> {
  const targetDate = toDateOnlyString(draft.target_date);
  const requestSource = normalizeRequestSource(draft.request_source);
  const where = buildJobLookup(draft, requestSource, targetDate);
  const existing = await repo.findOne({
    where,
    select: ['id', 'status', 'target_time'],
  });
  if (existing) {
    return updateExistingJob(repo, existing, draft);
  }

  const inserted = await insertSuggestionGenerationJob(repo, draft);
  if (inserted) return true;

  const conflicting = await repo.findOne({
    where,
    select: ['id', 'status', 'target_time'],
  });
  if (!conflicting) return false;
  return updateExistingJob(repo, conflicting, draft);
}

async function updateExistingJob(
  repo: Repository<SuggestionGenerationJob>,
  existing: Pick<SuggestionGenerationJob, 'id' | 'status' | 'target_time'>,
  draft: SuggestionGenerationJobDraft,
): Promise<boolean> {
  if (shouldKeepExistingJob(existing, draft)) return false;
  await repo.update({ id: existing.id }, buildJobUpdate(draft));
  return true;
}

function shouldKeepExistingJob(
  existing: Pick<SuggestionGenerationJob, 'status' | 'target_time'>,
  draft: SuggestionGenerationJobDraft,
): boolean {
  if (existing.status === SuggestionGenerationJobStatus.Running) return true;
  return (
    existing.status === SuggestionGenerationJobStatus.Queued &&
    clockTimesEqual(existing.target_time, draft.target_time)
  );
}

function buildJobLookup(
  draft: SuggestionGenerationJobDraft,
  requestSource: SuggestionRequestSource,
  targetDate: string,
): FindOptionsWhere<SuggestionGenerationJob> {
  if (requestSource === SuggestionRequestSource.OnDemand) {
    if (!draft.suggestion_instance_id) {
      throw new Error('On-demand generation jobs require a suggestion id.');
    }
    return {
      suggestion_instance_id: draft.suggestion_instance_id,
      request_source: requestSource,
    };
  }

  if (!draft.slot_id) {
    throw new Error('Scheduled generation jobs require a slot id.');
  }
  return {
    user_id: draft.user_id,
    slot_id: draft.slot_id,
    target_date: targetDate,
    request_source: requestSource,
  };
}

function buildJobRow(
  draft: SuggestionGenerationJobDraft,
): QueryDeepPartialEntity<SuggestionGenerationJob> {
  const requestSource = normalizeRequestSource(draft.request_source);
  return {
    id: ulid(),
    ...draft,
    request_source: requestSource,
    suggestion_instance_id: suggestionInstanceIdForSource(draft, requestSource),
    slot_id: draft.slot_id ?? null,
    target_date: toDateOnlyString(draft.target_date),
    target_time: toTimeOnlyString(draft.target_time),
    locked_at: null,
    locked_by: null,
  };
}

function buildJobUpdate(
  draft: SuggestionGenerationJobDraft,
): QueryDeepPartialEntity<SuggestionGenerationJob> {
  const requestSource = normalizeRequestSource(draft.request_source);
  return {
    ...draft,
    request_source: requestSource,
    suggestion_instance_id: suggestionInstanceIdForSource(draft, requestSource),
    slot_id: draft.slot_id ?? null,
    target_date: toDateOnlyString(draft.target_date),
    target_time: toTimeOnlyString(draft.target_time),
    locked_at: null,
    locked_by: null,
  };
}

function normalizeRequestSource(
  value: SuggestionRequestSource | null | undefined,
): SuggestionRequestSource {
  return value ?? SuggestionRequestSource.Scheduled;
}

function suggestionInstanceIdForSource(
  draft: SuggestionGenerationJobDraft,
  requestSource: SuggestionRequestSource,
): string | null {
  return requestSource === SuggestionRequestSource.OnDemand
    ? (draft.suggestion_instance_id ?? null)
    : null;
}
