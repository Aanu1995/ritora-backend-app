import { In, Repository } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { SlotModeValue } from '../../schedule/dto/schedule.constants';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SuggestionGenerationStatus,
  SuggestionMode,
} from '../suggestions.constants';
import { mapDayOfWeekShort } from './suggestion-history.helpers';
import { clockTimesEqual, compareClockTimes } from './suggestion-helpers';

export async function includeHistoricalSlotsForReadySuggestions(params: {
  slotRepo: Repository<ScheduleSlot>;
  userId: string;
  activeSlots: ScheduleSlot[];
  scheduledSuggestions: SuggestionInstance[];
}): Promise<ScheduleSlot[]> {
  const { slotRepo, userId, activeSlots, scheduledSuggestions } = params;
  const activeSlotById = new Map(activeSlots.map((slot) => [slot.id, slot]));
  const activeSlotIds = new Set(activeSlotById.keys());
  const missingSlotIds = Array.from(
    new Set(
      scheduledSuggestions.flatMap((suggestion) => {
        const slotId = suggestion.slot_id;
        return slotId &&
          suggestion.generation_status === SuggestionGenerationStatus.Ready &&
          !activeSlotIds.has(slotId)
          ? [slotId]
          : [];
      }),
    ),
  );
  const unlinkedReadySuggestions = scheduledSuggestions.filter(
    (suggestion) =>
      suggestion.generation_status === SuggestionGenerationStatus.Ready &&
      !suggestion.slot_id,
  );
  const retimedReadySuggestions = scheduledSuggestions.filter(
    (suggestion) =>
      suggestion.generation_status === SuggestionGenerationStatus.Ready &&
      hasActiveSlotAtDifferentTime(activeSlotById, suggestion),
  );
  if (
    missingSlotIds.length === 0 &&
    unlinkedReadySuggestions.length === 0 &&
    retimedReadySuggestions.length === 0
  ) {
    return activeSlots;
  }

  const historicalSlots =
    missingSlotIds.length > 0
      ? await slotRepo.find({
          where: { user_id: userId, id: In(missingSlotIds) },
          relations: ['steps', 'steps.product'],
        })
      : [];
  const historicalSlotIds = new Set(historicalSlots.map((slot) => slot.id));
  const fallbackSlots = missingSlotIds.flatMap((slotId) => {
    if (historicalSlotIds.has(slotId)) return [];
    const suggestion = scheduledSuggestions.find(
      (candidate) => candidate.slot_id === slotId,
    );
    return suggestion ? [historicalSlotFromSuggestion(userId, suggestion)] : [];
  });
  const unlinkedFallbackSlots = unlinkedReadySuggestions.map((suggestion) =>
    historicalSlotFromSuggestion(userId, suggestion),
  );
  const retimedFallbackSlots = retimedReadySuggestions.map((suggestion) =>
    historicalSlotFromSuggestion(
      userId,
      suggestion,
      historicalSnapshotSlotIdForSuggestion(suggestion),
    ),
  );

  return [
    ...activeSlots,
    ...historicalSlots,
    ...fallbackSlots,
    ...unlinkedFallbackSlots,
    ...retimedFallbackSlots,
  ].sort((a, b) => compareClockTimes(a.slot_time, b.slot_time));
}

export function historicalSlotIdForSuggestion(
  suggestion: SuggestionInstance,
): string {
  return suggestion.slot_id ?? `suggestion:${suggestion.id}`;
}

export function historicalSnapshotSlotIdForSuggestion(
  suggestion: SuggestionInstance,
): string {
  return `suggestion:${suggestion.id}`;
}

function historicalSlotFromSuggestion(
  userId: string,
  suggestion: SuggestionInstance,
  slotId = historicalSlotIdForSuggestion(suggestion),
): ScheduleSlot {
  const slot = new ScheduleSlot();
  slot.id = slotId;
  slot.user_id = userId;
  slot.day_of_week = mapDayOfWeekShort(
    'UTC',
    new Date(`${toDateOnlyString(suggestion.target_date)}T00:00:00.000Z`),
  );
  slot.slot_time = toTimeOnlyString(suggestion.target_time);
  slot.mode =
    suggestion.mode === SuggestionMode.Manual
      ? SlotModeValue.Manual
      : SlotModeValue.Ai;
  slot.slot_notes = null;
  slot.specialist_provider_name = null;
  slot.specialist_clinic_name = null;
  slot.specialist_active_since = null;
  slot.specialist_safety_notes = null;
  slot.deleted_at = null;
  slot.steps = [];
  return slot;
}

function hasActiveSlotAtDifferentTime(
  activeSlotById: ReadonlyMap<string, ScheduleSlot>,
  suggestion: SuggestionInstance,
): boolean {
  if (!suggestion.slot_id) return false;
  const activeSlot = activeSlotById.get(suggestion.slot_id);
  if (!activeSlot) return false;
  return !clockTimesEqual(activeSlot.slot_time, suggestion.target_time);
}
