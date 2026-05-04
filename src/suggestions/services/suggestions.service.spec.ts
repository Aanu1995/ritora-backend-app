import { ConflictException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionHistoryReader } from './suggestion-history-reader.service';
import { SuggestionsService } from './suggestions.service';

describe('SuggestionsService', () => {
  const suggestionRepo = repo<SuggestionInstance>();
  const jobRepo = repo<SuggestionGenerationJob>();
  const slotRepo = repo<ScheduleSlot>();
  const applicationLogRepo = repo<ApplicationLog>();
  const preferenceRepo = repo<UserNotificationPreference>();
  const historyReader = {
    getHistory: jest.fn(),
    getHistoryDay: jest.fn(),
  } as unknown as jest.Mocked<SuggestionHistoryReader>;

  const service = new SuggestionsService(
    suggestionRepo,
    jobRepo,
    slotRepo,
    applicationLogRepo,
    preferenceRepo,
    historyReader,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T10:00:00.000Z'));
    suggestionRepo.create.mockImplementation(
      (value) => value as SuggestionInstance,
    );
    suggestionRepo.save.mockImplementation(
      async (value) => value as SuggestionInstance,
    );
    jobRepo.findOne.mockResolvedValue(null);
    jobRepo.insert.mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a replacement pending suggestion with a concrete job id when regenerating', async () => {
    suggestionRepo.findOne.mockResolvedValue({
      id: 'suggestion-1',
      user_id: 'user-1',
      slot_id: 'slot-1',
      target_date: '2026-04-29',
      target_time: '12:00',
      daypart: 'noon',
      mode: 'ai',
      generation_status: 'ready',
      visible_at: new Date('2026-04-29T10:00:00.000Z'),
    } as SuggestionInstance);

    const result = await service.regenerateSuggestion(user(), 'suggestion-1', {
      reason: 'reaction_detected',
    });

    expect(suggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'suggestion-1',
        generation_status: 'superseded',
      }),
    );
    expect(suggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '12:00',
        daypart: 'noon',
        generation_status: 'pending',
        visible_at: new Date('2026-04-29T10:00:00.000Z'),
        supersedes_id: 'suggestion-1',
      }),
    );
    expect(jobRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        run_after: new Date('2026-04-29T10:00:00.000Z'),
        last_error: 'regenerate:reaction_detected',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        slotId: 'slot-1',
        generationStatus: 'pending',
      }),
    );
  });

  it('rejects regeneration when the suggestion no longer belongs to a schedule slot', async () => {
    suggestionRepo.findOne.mockResolvedValue({
      id: 'suggestion-1',
      user_id: 'user-1',
      slot_id: null,
      target_date: '2026-04-29',
      target_time: '12:00',
      daypart: 'noon',
      mode: 'ai',
      generation_status: 'ready',
      visible_at: new Date('2026-04-29T10:00:00.000Z'),
    } as SuggestionInstance);

    await expect(
      service.regenerateSuggestion(user(), 'suggestion-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    insert: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function user(): User {
  return {
    id: 'user-1',
    time_zone: 'UTC',
  } as User;
}
