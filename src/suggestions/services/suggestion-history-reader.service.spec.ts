import { ObjectLiteral, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionHistoryReader } from './suggestion-history-reader.service';

describe('SuggestionHistoryReader', () => {
  const suggestionRepo = repo<SuggestionInstance>();
  const slotRepo = repo<ScheduleSlot>();
  const applicationLogRepo = repo<ApplicationLog>();
  const reader = new SuggestionHistoryReader(
    suggestionRepo,
    slotRepo,
    applicationLogRepo,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not include scheduled slots when no suggestion was provided', async () => {
    suggestionRepo.find.mockResolvedValue([]);

    const day = await reader.getHistoryDay(
      { id: 'user-1', time_zone: 'UTC' } as User,
      null,
      '2026-04-29',
    );

    expect(day.slots).toEqual([]);
    expect(suggestionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ generation_status: 'ready' }),
      }),
    );
    expect(slotRepo.find).not.toHaveBeenCalled();
  });

  it('requests only ready suggestions for history list so failed jobs stay hidden', async () => {
    suggestionRepo.find.mockResolvedValue([]);

    await reader.getHistory({ id: 'user-1', time_zone: 'UTC' } as User, null, {
      range: '7d',
    });

    expect(suggestionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ generation_status: 'ready' }),
      }),
    );
    expect(slotRepo.find).not.toHaveBeenCalled();
  });

  it('keeps today out of history day detail', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T10:00:00.000Z'));

    const day = await reader.getHistoryDay(
      { id: 'user-1', time_zone: 'UTC' } as User,
      null,
      '2026-04-29',
    );

    expect(day.slots).toEqual([]);
    expect(suggestionRepo.find).not.toHaveBeenCalled();
  });

  it('returns provided suggestions with full detail for history day comparison', async () => {
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'suggestion-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '08:00',
        daypart: 'morning',
        mode: 'ai',
        generation_status: 'ready',
        visible_at: new Date('2026-04-29T06:00:00.000Z'),
        generated_at: new Date('2026-04-29T06:01:00.000Z'),
        ai_model: 'gpt-4.1-mini',
        ai_prompt_version: '2026-05-03.v1',
        simplified_for_reaction: false,
        has_reaction_signal: false,
        steps: [],
        gap_recommendations: [],
        safety_flags: [],
        generation_context: null,
        ai_explanation: null,
        created_at: new Date('2026-04-29T06:00:00.000Z'),
        updated_at: new Date('2026-04-29T06:01:00.000Z'),
      } as unknown as SuggestionInstance,
    ]);
    applicationLogRepo.find.mockResolvedValue([]);
    slotRepo.findBy.mockResolvedValue([
      {
        id: 'slot-1',
        slot_time: '08:00',
      } as ScheduleSlot,
    ]);
    slotRepo.find.mockResolvedValue([]);

    const day = await reader.getHistoryDay(
      { id: 'user-1', time_zone: 'UTC' } as User,
      null,
      '2026-04-29',
    );

    expect(day.slots[0]).toEqual(
      expect.objectContaining({
        suggestionId: 'suggestion-1',
        status: 'missed',
        suggestion: expect.objectContaining({
          id: 'suggestion-1',
          aiModel: 'gpt-4.1-mini',
        }),
      }),
    );
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    find: jest.fn(),
    findBy: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}
