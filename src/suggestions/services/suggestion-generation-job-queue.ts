import { QueryDeepPartialEntity, Repository } from 'typeorm';
import { ulid } from 'ulid';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';

export type SuggestionGenerationJobDraft = Pick<
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
  const existing = await repo.findOne({
    where: {
      user_id: draft.user_id,
      slot_id: draft.slot_id,
      target_date: targetDate,
    },
    select: ['id'],
  });
  if (existing) {
    await repo.update({ id: existing.id }, buildJobUpdate(draft));
    return;
  }

  const inserted = await insertSuggestionGenerationJob(repo, draft);
  if (inserted) return;

  await repo.update(
    {
      user_id: draft.user_id,
      slot_id: draft.slot_id,
      target_date: targetDate,
    },
    buildJobUpdate(draft),
  );
}

function buildJobRow(
  draft: SuggestionGenerationJobDraft,
): QueryDeepPartialEntity<SuggestionGenerationJob> {
  return {
    id: ulid(),
    ...draft,
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
    target_date: toDateOnlyString(draft.target_date),
    target_time: toTimeOnlyString(draft.target_time),
    locked_at: null,
    locked_by: null,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
