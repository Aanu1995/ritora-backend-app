import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  RECORDING_REMINDER_DELAY_MINUTES,
  SuggestionSlotLifecycleStatus,
} from '../suggestions.constants';
import { buildSlotInstant, endOfLocalDateInstant } from './suggestion-helpers';

export type SuggestionLifecycleInput = {
  suggestion: SuggestionInstance | null;
  applicationLog: ApplicationLog | null;
  targetDate: string;
  slotTime: string;
  visibleAt: Date;
  now: Date;
  timeZone: string;
};

export type SuggestionLifecycle = {
  status: SuggestionSlotLifecycleStatus;
  slotStartsAt: Date;
  recordableAt: Date;
  expiresAt: Date;
};

export function computeSuggestionLifecycle(
  input: SuggestionLifecycleInput,
): SuggestionLifecycle {
  const slotStartsAt = buildSlotInstant(
    input.targetDate,
    input.slotTime,
    input.timeZone,
  );
  const recordableAt = new Date(
    slotStartsAt.getTime() + RECORDING_REMINDER_DELAY_MINUTES * 60_000,
  );
  const expiresAt = endOfLocalDateInstant(input.targetDate, input.timeZone);
  const nowMs = input.now.getTime();

  return {
    slotStartsAt,
    recordableAt,
    expiresAt,
    status: resolveLifecycleStatus({
      suggestion: input.suggestion,
      applicationLog: input.applicationLog,
      visibleAt: input.visibleAt,
      slotStartsAt,
      recordableAt,
      expiresAt,
      nowMs,
    }),
  };
}

function resolveLifecycleStatus(input: {
  suggestion: SuggestionInstance | null;
  applicationLog: ApplicationLog | null;
  visibleAt: Date;
  slotStartsAt: Date;
  recordableAt: Date;
  expiresAt: Date;
  nowMs: number;
}): SuggestionSlotLifecycleStatus {
  if (input.applicationLog?.has_been_edited) return 'edited';
  if (input.applicationLog) return 'recorded';

  const suggestionStatus = input.suggestion?.generation_status ?? null;
  if (suggestionStatus === 'failed') return 'failed';
  if (suggestionStatus === 'generating') return 'generating';
  if (
    suggestionStatus === 'pending' &&
    input.nowMs >= input.visibleAt.getTime()
  ) {
    return 'generating';
  }

  if (input.nowMs > input.expiresAt.getTime()) return 'missed';
  if (input.nowMs < input.visibleAt.getTime()) return 'locked';
  if (!input.suggestion || suggestionStatus !== 'ready') return 'generating';
  if (input.nowMs >= input.recordableAt.getTime()) return 'recordable';
  if (input.nowMs >= input.slotStartsAt.getTime()) return 'active';
  return 'ready';
}
