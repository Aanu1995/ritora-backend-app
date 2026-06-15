import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionGenerationStatus } from '../suggestions.constants';
import { clockTimesEqual } from './suggestion-helpers';
import {
  historicalSlotIdForSuggestion,
  historicalSnapshotSlotIdForSuggestion,
} from './today-schedule-slot-resolver';

export function mapLatestSuggestionBySlot(
  suggestions: SuggestionInstance[],
  activeSlots: ScheduleSlot[] = [],
): Map<string, SuggestionInstance> {
  const map = new Map<string, SuggestionInstance>();
  const activeSlotById = new Map(activeSlots.map((slot) => [slot.id, slot]));
  for (const suggestion of suggestions) {
    const slotId = todaySlotIdForSuggestion(suggestion, activeSlotById);
    const existing = map.get(slotId);
    if (!existing || isNewerSuggestion(suggestion, existing)) {
      map.set(slotId, suggestion);
    }
  }
  return map;
}

function todaySlotIdForSuggestion(
  suggestion: SuggestionInstance,
  activeSlotById: ReadonlyMap<string, ScheduleSlot>,
): string {
  if (
    suggestion.generation_status === SuggestionGenerationStatus.Ready &&
    hasActiveSlotAtDifferentTime(suggestion, activeSlotById)
  ) {
    return historicalSnapshotSlotIdForSuggestion(suggestion);
  }
  return historicalSlotIdForSuggestion(suggestion);
}

function hasActiveSlotAtDifferentTime(
  suggestion: SuggestionInstance,
  activeSlotById: ReadonlyMap<string, ScheduleSlot>,
): boolean {
  if (!suggestion.slot_id) return false;
  const activeSlot = activeSlotById.get(suggestion.slot_id);
  if (!activeSlot) return false;
  return !clockTimesEqual(activeSlot.slot_time, suggestion.target_time);
}

export function mapLatestApplicationLogBySuggestion(
  logs: ApplicationLog[],
): Map<string, ApplicationLog> {
  const map = new Map<string, ApplicationLog>();
  for (const log of logs) {
    if (!log.suggestion_instance_id) continue;
    const existing = map.get(log.suggestion_instance_id);
    if (!existing || isNewerApplicationLog(log, existing)) {
      map.set(log.suggestion_instance_id, log);
    }
  }
  return map;
}

function isNewerSuggestion(
  candidate: SuggestionInstance,
  existing: SuggestionInstance,
): boolean {
  return (
    (candidate.generated_at?.getTime() ?? 0) >
    (existing.generated_at?.getTime() ?? 0)
  );
}

function isNewerApplicationLog(
  candidate: ApplicationLog,
  existing: ApplicationLog,
): boolean {
  return (
    (candidate.updated_at?.getTime() ?? 0) >
    (existing.updated_at?.getTime() ?? 0)
  );
}
