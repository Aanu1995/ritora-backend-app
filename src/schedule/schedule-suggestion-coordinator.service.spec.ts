import { Repository } from 'typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { UserNotificationPreference } from '../notifications/entities/user-notification-preference.entity';
import { SuggestionGenerationJob } from '../suggestions/entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { User } from '../users/entities/user.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import { ScheduleSuggestionCoordinator } from './schedule-suggestion-coordinator.service';

type MockRepo<T> = {
  create: jest.Mock<T, [Partial<T>]>;
  find: jest.Mock<Promise<T[]>, [unknown?]>;
  findOne: jest.Mock<Promise<T | null>, [unknown?]>;
  insert: jest.Mock<Promise<unknown>, [unknown]>;
  save: jest.Mock<Promise<T | T[]>, [T | T[]]>;
  update: jest.Mock<Promise<unknown>, [unknown, unknown]>;
};

function repo<T>(): MockRepo<T> {
  return {
    create: jest.fn((value: Partial<T>) => value as T),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue({}),
    save: jest.fn(async (value: T | T[]) => value),
    update: jest.fn().mockResolvedValue({}),
  };
}

describe('ScheduleSuggestionCoordinator', () => {
  const suggestionRepo = repo<SuggestionInstance>();
  const jobRepo = repo<SuggestionGenerationJob>();
  const userRepo = repo<User>();
  const preferenceRepo = repo<UserNotificationPreference>();
  const applicationLogRepo = repo<ApplicationLog>();

  let service: ScheduleSuggestionCoordinator;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T06:30:00.000Z'));
    jest.clearAllMocks();
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      time_zone: 'UTC',
      email_verified: true,
    } as User);
    preferenceRepo.findOne.mockResolvedValue({
      user_id: 'user-1',
      suggestion_lead_time_minutes: 120,
    } as UserNotificationPreference);
    applicationLogRepo.find.mockResolvedValue([]);

    service = new ScheduleSuggestionCoordinator(
      suggestionRepo as unknown as Repository<SuggestionInstance>,
      jobRepo as unknown as Repository<SuggestionGenerationJob>,
      userRepo as unknown as Repository<User>,
      preferenceRepo as unknown as Repository<UserNotificationPreference>,
      applicationLogRepo as unknown as Repository<ApplicationLog>,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('supersedes unready visible suggestions and queues a fresh generation after schedule edits', async () => {
    const existing = suggestion({
      id: 'suggestion-1',
      generation_status: 'generating',
    });
    suggestionRepo.find.mockResolvedValue([existing]);

    await service.handleSlotChanged('user-1', scheduleSlot());

    expect(existing.generation_status).toBe('superseded');
    expect(suggestionRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.objectContaining({ _type: 'in' }) }),
      expect.objectContaining({ generation_status: 'superseded' }),
    );
    expect(suggestionRepo.save).toHaveBeenCalledTimes(1);
    expect(suggestionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-05-04',
        target_time: '08:00:00',
        generation_status: 'pending',
        supersedes_id: 'suggestion-1',
      }),
    );
    expect(jobRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-05-04',
        target_time: '08:00:00',
        status: 'queued',
        last_error: 'schedule_change',
      }),
    );
  });

  it('keeps a ready same-day suggestion at its original time when the edited routine time has already started', async () => {
    jest.setSystemTime(new Date('2026-05-04T07:30:00.000Z'));
    const existing = suggestion({
      id: 'suggestion-1',
      target_time: '08:00:00',
      generation_status: 'ready',
    });
    suggestionRepo.find.mockResolvedValue([existing]);

    await service.handleSlotChanged(
      'user-1',
      scheduleSlot({ slot_time: '07:00:00' }),
    );

    expect(existing.generation_status).toBe('ready');
    expect(existing.target_time).toBe('08:00:00');
    expect(jobRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
      }),
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(suggestionRepo.create).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('keeps a ready same-day suggestion and queues a new one when the edited routine time is still upcoming', async () => {
    jest.setSystemTime(new Date('2026-05-04T07:30:00.000Z'));
    const existing = suggestion({
      id: 'suggestion-1',
      target_time: '08:00:00',
      generation_status: 'ready',
    });
    suggestionRepo.find.mockResolvedValue([existing]);

    await service.handleSlotChanged(
      'user-1',
      scheduleSlot({ slot_time: '09:00:00' }),
    );

    expect(existing.generation_status).toBe('ready');
    expect(existing.target_time).toBe('08:00:00');
    expect(suggestionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-05-04',
        target_time: '09:00:00',
        generation_status: 'pending',
        supersedes_id: 'suggestion-1',
      }),
    );
    expect(jobRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-05-04',
        target_time: '09:00:00',
        status: 'queued',
        last_error: 'schedule_change',
      }),
    );
  });

  it('does not queue a duplicate when the ready suggestion matches the slot time with different precision', async () => {
    const existing = suggestion({
      id: 'suggestion-1',
      target_time: '08:00',
      generation_status: 'ready',
    });
    suggestionRepo.find.mockResolvedValue([existing]);

    await service.handleSlotChanged('user-1', scheduleSlot());

    expect(existing.generation_status).toBe('ready');
    expect(suggestionRepo.create).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('keeps recorded suggestions and does not replace them', async () => {
    const recorded = suggestion({
      id: 'suggestion-recorded',
      generation_status: 'ready',
    });
    suggestionRepo.find.mockResolvedValue([recorded]);
    applicationLogRepo.find.mockResolvedValue([
      { suggestion_instance_id: 'suggestion-recorded' } as ApplicationLog,
    ]);

    await service.handleSlotChanged('user-1', scheduleSlot());

    expect(recorded.generation_status).toBe('ready');
    expect(suggestionRepo.create).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('cancels unrecorded suggestions without requeueing when a routine time is deleted', async () => {
    const existing = suggestion({
      id: 'suggestion-1',
      generation_status: 'pending',
    });
    suggestionRepo.find.mockResolvedValue([existing]);

    await service.handleSlotRemoved('user-1', scheduleSlot());

    expect(existing.generation_status).toBe('superseded');
    expect(suggestionRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.objectContaining({ _type: 'in' }) }),
      expect.objectContaining({ generation_status: 'superseded' }),
    );
    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(jobRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
      }),
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('keeps ready suggestions visible after their routine time is deleted', async () => {
    const existing = suggestion({
      id: 'suggestion-ready',
      generation_status: 'ready',
    });
    suggestionRepo.find.mockResolvedValue([existing]);

    await service.handleSlotRemoved('user-1', scheduleSlot());

    expect(existing.generation_status).toBe('ready');
    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(jobRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
      }),
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });
});

function scheduleSlot(overrides: Partial<ScheduleSlot> = {}): ScheduleSlot {
  return {
    id: 'slot-1',
    user_id: 'user-1',
    day_of_week: 'mon',
    slot_time: '08:00:00',
    mode: 'ai',
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
  overrides: Partial<SuggestionInstance> = {},
): SuggestionInstance {
  return {
    id: 'suggestion-1',
    user_id: 'user-1',
    slot_id: 'slot-1',
    request_source: 'scheduled',
    target_date: '2026-05-04',
    target_time: '08:00:00',
    daypart: 'morning',
    mode: 'ai',
    generation_status: 'ready',
    visible_at: new Date('2026-05-04T06:00:00.000Z'),
    generated_at: new Date('2026-05-04T06:05:00.000Z'),
    has_reaction_signal: false,
    simplified_for_reaction: false,
    ...overrides,
  } as SuggestionInstance;
}
