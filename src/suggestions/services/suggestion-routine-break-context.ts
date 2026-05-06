import { toDateOnlyString, toIsoString } from '../../common/utils/date';
import { RoutineBreak } from '../entities/routine-break.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';

const RECENT_RESUME_WINDOW_DAYS = 7;

export function buildRoutineBreakSummary(
  breaks: RoutineBreak[],
  targetDate: string,
): SuggestionContextSummary['routineBreak'] {
  const latest = breaks.slice().sort(compareBreakRecency)[0] ?? null;
  if (!latest) {
    return {
      recentlyResumed: false,
      lastPausedFrom: null,
      lastPausedUntil: null,
    };
  }

  const resumeDate = latest.resumed_at ?? latest.ends_at;
  return {
    recentlyResumed:
      resumeDate !== null &&
      daysBetween(resumeDate, targetDate) <= RECENT_RESUME_WINDOW_DAYS,
    lastPausedFrom: toIsoString(latest.starts_at),
    lastPausedUntil: resumeDate ? toIsoString(resumeDate) : null,
  };
}

export function routineBreakCacheParts(
  breaks: RoutineBreak[],
): (string | null)[][] {
  return breaks
    .slice()
    .sort(compareBreakRecency)
    .map((breakRow) => [
      breakRow.id,
      toIsoString(breakRow.starts_at),
      breakRow.ends_at ? toIsoString(breakRow.ends_at) : null,
      breakRow.resumed_at ? toIsoString(breakRow.resumed_at) : null,
      breakRow.status,
    ]);
}

function compareBreakRecency(
  first: RoutineBreak,
  second: RoutineBreak,
): number {
  return second.starts_at.getTime() - first.starts_at.getTime();
}

function daysBetween(fromDate: Date, targetDate: string): number {
  const from = new Date(`${toDateOnlyString(fromDate)}T00:00:00Z`).getTime();
  const to = new Date(`${toDateOnlyString(targetDate)}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
