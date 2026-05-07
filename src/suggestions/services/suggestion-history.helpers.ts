import { Between, FindOperator } from 'typeorm';
import { ApplicationItemStatus } from '../../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { toDateOnlyString } from '../../common/utils/date';
import { DayOfWeek } from '../../schedule/dto/schedule.constants';
import {
  SuggestionHistoryRange,
  SuggestionHistorySlotStatus,
} from '../suggestions.constants';
import { SuggestionHistoryListQueryDto } from '../dto/suggestion-history.dto';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';

export function computeSlotStatus(
  suggestion: SuggestionInstance,
  log: ApplicationLog | null,
): SuggestionHistorySlotStatus {
  if (suggestion.simplified_for_reaction) {
    return SuggestionHistorySlotStatus.Simplified;
  }
  if (!log) return SuggestionHistorySlotStatus.Missed;
  const totalSteps = suggestion.steps?.length ?? 0;
  if (totalSteps === 0) return SuggestionHistorySlotStatus.Missed;
  const exactAppliedCount =
    log.items?.filter((item) => item.status === ApplicationItemStatus.Applied)
      .length ?? 0;
  const appliedCount =
    log.items?.filter((item) => item.status !== ApplicationItemStatus.Skipped)
      .length ?? 0;
  if (exactAppliedCount === totalSteps) {
    return SuggestionHistorySlotStatus.Applied;
  }
  if (appliedCount === 0) return SuggestionHistorySlotStatus.Skipped;
  return SuggestionHistorySlotStatus.Partial;
}

export function buildSummaryLine(
  suggestion: SuggestionInstance,
  log: ApplicationLog | null,
  totalSteps: number,
  appliedCount: number,
): string {
  if (suggestion.simplified_for_reaction) {
    return 'Simplified to barrier mode after the redness photo.';
  }
  if (!log) {
    return `${totalSteps} step${
      totalSteps === 1 ? '' : 's'
    } suggested. No record yet.`;
  }
  const exactAppliedCount =
    log.items?.filter((item) => item.status === ApplicationItemStatus.Applied)
      .length ?? 0;
  const substitutionCount =
    log.items?.filter(
      (item) => item.status === ApplicationItemStatus.Substituted,
    ).length ?? 0;
  if (exactAppliedCount === totalSteps) {
    return `${appliedCount} of ${totalSteps} applied. Matches the suggestion.`;
  }
  if (substitutionCount > 0) {
    return `${appliedCount} of ${totalSteps} used, with substitutions.`;
  }
  return `${appliedCount} of ${totalSteps} applied.`;
}

export function rangeWhere(
  fromDate: string,
  toDate: string,
): FindOperator<string> {
  return Between(fromDate, toDate);
}

export function computeRange(
  query: SuggestionHistoryListQueryDto,
  historyEndDate: string,
): { fromDate: string; toDate: string } {
  if (query.range === SuggestionHistoryRange.Custom && query.from && query.to) {
    return {
      fromDate: query.from,
      toDate: minDateString(query.to, historyEndDate),
    };
  }
  const days = query.range === SuggestionHistoryRange.ThirtyDays ? 30 : 7;
  const end = new Date(`${historyEndDate}T00:00:00Z`);
  const from = new Date(end.getTime() - (days - 1) * 86_400_000);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: historyEndDate,
  };
}

export function isDateBefore(date: string, comparison: string): boolean {
  return toDateOnlyString(date) < toDateOnlyString(comparison);
}

export function shiftIsoDate(date: string, days: number): string {
  const current = new Date(`${toDateOnlyString(date)}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

function minDateString(first: string, second: string): string {
  return first < second ? first : second;
}

export function mapDayOfWeekShort(
  timeZone: string,
  now = new Date(),
): DayOfWeek {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  });
  const value = formatter.format(now).toLowerCase().slice(0, 3);
  return value as DayOfWeek;
}
