import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { historicalSlotIdForSuggestion } from './today-schedule-slot-resolver';

export function mapLatestSuggestionBySlot(
  suggestions: SuggestionInstance[],
): Map<string, SuggestionInstance> {
  const map = new Map<string, SuggestionInstance>();
  for (const suggestion of suggestions) {
    const slotId = historicalSlotIdForSuggestion(suggestion);
    const existing = map.get(slotId);
    if (!existing || isNewerSuggestion(suggestion, existing)) {
      map.set(slotId, suggestion);
    }
  }
  return map;
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
