import { toTimeOnlyString } from '../../common/utils/date';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import {
  SuggestionHistoryDayDto,
  SuggestionHistorySlotSummaryDto,
} from '../dto/suggestion-history.dto';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  buildSummaryLine,
  computeSlotStatus,
} from './suggestion-history.helpers';

export function buildHistorySlotSummary(
  suggestion: SuggestionInstance,
  log: ApplicationLog | null,
  slot: ScheduleSlot | undefined,
  totalSteps: number,
  appliedCount: number,
): SuggestionHistorySlotSummaryDto {
  return {
    slotId: suggestion.slot_id,
    suggestionId: suggestion.id,
    applicationLogId: log?.id ?? null,
    requestSource: suggestion.request_source ?? 'scheduled',
    onDemandIntent:
      suggestion.request_source === 'on_demand'
        ? (suggestion.request_context?.intent ?? null)
        : null,
    daypart: suggestion.daypart,
    slotTime: toTimeOnlyString(slot?.slot_time ?? suggestion.target_time),
    mode: suggestion.mode,
    appliedCount,
    totalSteps,
    status: computeSlotStatus(suggestion, log),
    hasBeenEdited: log?.has_been_edited ?? false,
    summaryLine: buildSummaryLine(suggestion, log, totalSteps, appliedCount),
  };
}

export function getOrCreateHistoryDay(
  dayMap: Map<string, SuggestionHistoryDayDto>,
  date: string,
): SuggestionHistoryDayDto {
  return dayMap.get(date) ?? emptyHistoryDay(date);
}

export function emptyHistoryDay(date: string): SuggestionHistoryDayDto {
  return {
    date,
    weatherSummary: null,
    moodScore: null,
    hydrationTrend: null,
    reactionFlagged: false,
    photoEntryId: null,
    slots: [],
  };
}

export function applyJournalMetadata(
  day: SuggestionHistoryDayDto,
  entry: SkinJournalEntry | undefined,
): SuggestionHistoryDayDto {
  if (!entry) return day;
  day.photoEntryId = entry.photo_object_key ? entry.id : null;
  day.moodScore = moodScore(entry.overall_feel);
  day.hydrationTrend = hydrationTrend(entry);
  day.reactionFlagged = day.reactionFlagged || entry.has_reaction_signal;
  return day;
}

export function mapLogsBySuggestion(
  logs: ApplicationLog[],
): Map<string, ApplicationLog> {
  const map = new Map<string, ApplicationLog>();
  for (const log of logs) {
    if (log.suggestion_instance_id) {
      map.set(log.suggestion_instance_id, log);
    }
  }
  return map;
}

export function countAppliedItems(log: ApplicationLog | null): number {
  return log?.items?.filter((item) => item.status !== 'skipped').length ?? 0;
}

export function sortHistoryDays(
  dayMap: Map<string, SuggestionHistoryDayDto>,
): SuggestionHistoryDayDto[] {
  const days = Array.from(dayMap.values()).sort((a, b) =>
    a.date < b.date ? 1 : -1,
  );
  for (const day of days) {
    day.slots.sort((a, b) => a.slotTime.localeCompare(b.slotTime));
  }
  return days;
}

function moodScore(value: SkinJournalEntry['overall_feel']): number | null {
  if (value === 'awful') return 1;
  if (value === 'bad') return 2;
  if (value === 'ok') return 3;
  if (value === 'good') return 4;
  if (value === 'great') return 5;
  return null;
}

function hydrationTrend(
  entry: SkinJournalEntry,
): SuggestionHistoryDayDto['hydrationTrend'] {
  const change = entry.analysis_observations?.overall_change_from_previous;
  if (change === 'improved') return 'up';
  if (change === 'worsened') return 'down';
  if (change === 'stable') return 'flat';
  return null;
}
