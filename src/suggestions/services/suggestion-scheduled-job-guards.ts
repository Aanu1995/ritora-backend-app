import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { mapDayOfWeekShort } from './suggestion-history.helpers';
import { buildSlotInstant, clockTimesEqual } from './suggestion-helpers';

export function scheduledJobStillMatchesSlot(
  job: SuggestionGenerationJob,
  slot: ScheduleSlot,
  targetDate: string,
  targetTime: string,
): boolean {
  return (
    slot.user_id === job.user_id &&
    clockTimesEqual(slot.slot_time, targetTime) &&
    slot.day_of_week ===
      mapDayOfWeekShort('UTC', new Date(`${targetDate}T00:00:00.000Z`))
  );
}

export function hasScheduledSlotElapsed(input: {
  targetDate: string;
  targetTime: string;
  timeZone: string;
  now?: Date;
}): boolean {
  const slotInstant = buildSlotInstant(
    input.targetDate,
    input.targetTime,
    input.timeZone,
  );
  return slotInstant.getTime() <= (input.now ?? new Date()).getTime();
}
