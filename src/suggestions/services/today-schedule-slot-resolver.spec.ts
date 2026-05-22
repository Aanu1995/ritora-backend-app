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
});

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
