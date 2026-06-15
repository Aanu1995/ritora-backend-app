import { Repository } from 'typeorm';
import { SlotModeValue } from '../../schedule/dto/schedule.constants';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SuggestionDaypart,
  SuggestionGenerationStatus,
  SuggestionMode,
  SuggestionRequestSource,
} from '../suggestions.constants';
import { includeHistoricalSlotsForReadySuggestions } from './today-schedule-slot-resolver';

describe('includeHistoricalSlotsForReadySuggestions', () => {
  it('creates a typed fallback slot when a ready suggestion outlives its deleted schedule slot', async () => {
    const slotRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<ScheduleSlot>;

    const slots = await includeHistoricalSlotsForReadySuggestions({
      slotRepo,
      userId: 'user-1',
      activeSlots: [],
      scheduledSuggestions: [
        suggestion({
          slot_id: 'deleted-slot-1',
          target_date: '2026-05-08',
          target_time: '20:00',
          daypart: SuggestionDaypart.Evening,
          mode: SuggestionMode.Ai,
        }),
      ],
    });

    expect(slots).toHaveLength(1);
    expect(slots[0]).toBeInstanceOf(ScheduleSlot);
    expect(slots[0]).toEqual(
      expect.objectContaining({
        id: 'deleted-slot-1',
        user_id: 'user-1',
        day_of_week: 'fri',
        slot_time: '20:00',
        mode: SlotModeValue.Ai,
        steps: [],
      }),
    );
  });

  it('keeps a ready suggestion as a separate snapshot when its active slot moved to another time', async () => {
    const slotRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<ScheduleSlot>;

    const slots = await includeHistoricalSlotsForReadySuggestions({
      slotRepo,
      userId: 'user-1',
      activeSlots: [
        scheduleSlot({
          id: 'slot-1',
          slot_time: '09:00',
        }),
      ],
      scheduledSuggestions: [
        suggestion({
          id: 'suggestion-ready',
          slot_id: 'slot-1',
          target_date: '2026-05-08',
          target_time: '08:00',
          daypart: SuggestionDaypart.Morning,
          mode: SuggestionMode.Ai,
        }),
      ],
    });

    expect(slots).toEqual([
      expect.objectContaining({
        id: 'suggestion:suggestion-ready',
        slot_time: '08:00',
      }),
      expect.objectContaining({
        id: 'slot-1',
        slot_time: '09:00',
      }),
    ]);
    expect(slotRepo.find).not.toHaveBeenCalled();
  });

  it('does not create a snapshot when active slot and suggestion times differ only by seconds precision', async () => {
    const slotRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<ScheduleSlot>;

    const slots = await includeHistoricalSlotsForReadySuggestions({
      slotRepo,
      userId: 'user-1',
      activeSlots: [
        scheduleSlot({
          id: 'slot-1',
          slot_time: '08:00:00',
        }),
      ],
      scheduledSuggestions: [
        suggestion({
          id: 'suggestion-ready',
          slot_id: 'slot-1',
          target_date: '2026-05-08',
          target_time: '08:00',
          daypart: SuggestionDaypart.Morning,
          mode: SuggestionMode.Ai,
        }),
      ],
    });

    expect(slots).toEqual([
      expect.objectContaining({
        id: 'slot-1',
        slot_time: '08:00:00',
      }),
    ]);
    expect(slotRepo.find).not.toHaveBeenCalled();
  });
});

function scheduleSlot(overrides: Partial<ScheduleSlot>): ScheduleSlot {
  return {
    id: 'slot-1',
    user_id: 'user-1',
    day_of_week: 'fri',
    slot_time: '08:00',
    mode: SlotModeValue.Ai,
    slot_notes: null,
    specialist_provider_name: null,
    specialist_clinic_name: null,
    specialist_active_since: null,
    specialist_safety_notes: null,
    deleted_at: null,
    steps: [],
    ...overrides,
  } as ScheduleSlot;
}

function suggestion(
  overrides: Partial<SuggestionInstance>,
): SuggestionInstance {
  return {
    id: 'suggestion-1',
    user_id: 'user-1',
    slot_id: null,
    request_source: SuggestionRequestSource.Scheduled,
    target_date: '2026-05-08',
    target_time: '08:00',
    daypart: SuggestionDaypart.Morning,
    mode: SuggestionMode.Ai,
    generation_status: SuggestionGenerationStatus.Ready,
    steps: [],
    ...overrides,
  } as SuggestionInstance;
}
