import { FindOptionsWhere, QueryDeepPartialEntity, Repository } from 'typeorm';
import { ulid } from 'ulid';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionRequestSource } from '../suggestions.constants';

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
    if (isUniqueConstraintError(error)) return false;
    throw error;
  }
}

export async function requeueSuggestionGenerationJob(
  repo: Repository<SuggestionGenerationJob>,
  draft: SuggestionGenerationJobDraft,
): Promise<void> {
  const targetDate = toDateOnlyString(draft.target_date);
  const requestSource = normalizeRequestSource(draft.request_source);
  const where = buildJobLookup(draft, requestSource, targetDate);
  const existing = await repo.findOne({
    where,
    select: ['id'],
  });
  if (existing) {
    await repo.update({ id: existing.id }, buildJobUpdate(draft));
    return;
  }

  const inserted = await insertSuggestionGenerationJob(repo, draft);
  if (inserted) return;

  await repo.update(where, buildJobUpdate(draft));
}

function buildJobLookup(
  draft: SuggestionGenerationJobDraft,
  requestSource: SuggestionRequestSource,
  targetDate: string,
): FindOptionsWhere<SuggestionGenerationJob> {
  if (requestSource === 'on_demand') {
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
  return {
    id: ulid(),
    ...draft,
    request_source: normalizeRequestSource(draft.request_source),
    suggestion_instance_id: draft.suggestion_instance_id ?? null,
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
  return {
    ...draft,
    request_source: normalizeRequestSource(draft.request_source),
    suggestion_instance_id: draft.suggestion_instance_id ?? null,
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
  return value ?? 'scheduled';
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
