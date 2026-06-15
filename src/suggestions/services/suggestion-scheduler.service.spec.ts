import { ConfigService } from '@nestjs/config';
import { ObjectLiteral, Repository } from 'typeorm';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { RoutineBreakService } from './routine-break.service';
import { SuggestionScheduler } from './suggestion-scheduler.service';

describe('SuggestionScheduler', () => {
  const jobRepo = repo<SuggestionGenerationJob>();
  const suggestionRepo = repo<SuggestionInstance>();
  const slotRepo = repo<ScheduleSlot>();
  const userRepo = repo<User>();
  const preferenceRepo = repo<UserNotificationPreference>();
  const routineBreakService = {
    getActiveUserIds: jest.fn(),
  } as unknown as jest.Mocked<RoutineBreakService>;
  const scheduler = new SuggestionScheduler(
    { get: jest.fn().mockReturnValue('true') } as unknown as ConfigService,
    jobRepo,
    suggestionRepo,
    slotRepo,
    userRepo,
    preferenceRepo,
    routineBreakService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T04:00:00.000Z'));
    routineBreakService.getActiveUserIds.mockResolvedValue(new Set());
    suggestionRepo.find.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a pending suggestion row before enqueuing the generation job', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T06:00:00.000Z'));
    slotRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        user_id: 'user-1',
        day_of_week: 'wed',
        slot_time: '08:00',
        mode: 'ai',
      } as ScheduleSlot,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    preferenceRepo.find.mockResolvedValue([
      { user_id: 'user-1', suggestion_lead_time_minutes: 120 },
    ] as UserNotificationPreference[]);
    suggestionRepo.create.mockImplementation(
      (value) => value as SuggestionInstance,
    );
    suggestionRepo.save.mockResolvedValue({
      id: 'pending-1',
    } as SuggestionInstance);
    jobRepo.insert.mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    });

    const result = await scheduler.runOnce();

    expect(result.enqueued).toBe(1);
    expect(slotRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deleted_at: expect.objectContaining({ _type: 'isNull' }),
        },
        order: { id: 'ASC' },
        take: expect.any(Number),
      }),
    );
    expect(suggestionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: expect.objectContaining({ _type: 'in' }),
          slot_id: expect.objectContaining({ _type: 'in' }),
          target_date: expect.objectContaining({ _type: 'in' }),
          generation_status: expect.objectContaining({ _type: 'not' }),
        },
        select: [
          'id',
          'user_id',
          'slot_id',
          'target_date',
          'target_time',
          'generation_status',
        ],
      }),
    );
    expect(suggestionRepo.findOne).not.toHaveBeenCalled();
    expect(suggestionRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        generation_status: 'pending',
        visible_at: new Date('2026-04-29T06:00:00.000Z'),
      }),
    ]);
    expect(jobRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        run_after: new Date('2026-04-29T06:00:00.000Z'),
      }),
    );
  });

  it('does not enqueue future slots before their visibility window opens', async () => {
    slotRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        user_id: 'user-1',
        day_of_week: 'wed',
        slot_time: '08:00',
        mode: 'ai',
      } as ScheduleSlot,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    preferenceRepo.find.mockResolvedValue([
      { user_id: 'user-1', suggestion_lead_time_minutes: 120 },
    ] as UserNotificationPreference[]);

    const result = await scheduler.runOnce();

    expect(result.enqueued).toBe(0);
    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('does not backfill slots whose scheduled start time has already passed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T09:00:00.000Z'));
    slotRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        user_id: 'user-1',
        day_of_week: 'wed',
        slot_time: '08:00',
        mode: 'ai',
      } as ScheduleSlot,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    preferenceRepo.find.mockResolvedValue([
      { user_id: 'user-1', suggestion_lead_time_minutes: 120 },
    ] as UserNotificationPreference[]);

    const result = await scheduler.runOnce();

    expect(result.enqueued).toBe(0);
    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('does not requeue when a ready suggestion already exists for the same slot time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T06:00:00.000Z'));
    slotRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        user_id: 'user-1',
        day_of_week: 'wed',
        slot_time: '08:00',
        mode: 'ai',
      } as ScheduleSlot,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    preferenceRepo.find.mockResolvedValue([
      { user_id: 'user-1', suggestion_lead_time_minutes: 120 },
    ] as UserNotificationPreference[]);
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'pending-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '08:00',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);
    jobRepo.insert.mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );

    const result = await scheduler.runOnce();

    expect(result.enqueued).toBe(0);
    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(suggestionRepo.findOne).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
    expect(jobRepo.update).not.toHaveBeenCalled();
  });

  it('creates a new pending suggestion when the current slot time differs from an existing ready suggestion', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T07:00:00.000Z'));
    slotRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        user_id: 'user-1',
        day_of_week: 'wed',
        slot_time: '09:00',
        mode: 'ai',
      } as ScheduleSlot,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    preferenceRepo.find.mockResolvedValue([
      { user_id: 'user-1', suggestion_lead_time_minutes: 120 },
    ] as UserNotificationPreference[]);
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'ready-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '08:00',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);
    suggestionRepo.create.mockImplementation(
      (value) => value as SuggestionInstance,
    );
    mockSaveArray(suggestionRepo).mockResolvedValue([
      { id: 'pending-1' },
    ] as SuggestionInstance[]);
    jobRepo.findOne.mockResolvedValue({
      id: 'job-1',
    } as SuggestionGenerationJob);
    jobRepo.update.mockResolvedValue({
      generatedMaps: [],
      raw: [],
      affected: 1,
    });

    const result = await scheduler.runOnce();

    expect(result.enqueued).toBe(1);
    expect(suggestionRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '09:00',
        generation_status: 'pending',
      }),
    ]);
    expect(jobRepo.update).toHaveBeenCalledWith(
      { id: 'job-1' },
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '09:00',
        status: 'queued',
        run_after: new Date('2026-04-29T07:00:00.000Z'),
      }),
    );
  });

  it('does not rewrite an already queued same-time job for an existing pending suggestion', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T06:00:00.000Z'));
    slotRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        user_id: 'user-1',
        day_of_week: 'wed',
        slot_time: '08:00:00',
        mode: 'ai',
      } as ScheduleSlot,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    preferenceRepo.find.mockResolvedValue([
      { user_id: 'user-1', suggestion_lead_time_minutes: 120 },
    ] as UserNotificationPreference[]);
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'pending-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '08:00',
        generation_status: 'pending',
      } as SuggestionInstance,
    ]);
    jobRepo.findOne.mockResolvedValue({
      id: 'job-1',
      target_time: '08:00:00',
      status: 'queued',
    } as SuggestionGenerationJob);

    const result = await scheduler.runOnce();

    expect(result.enqueued).toBe(0);
    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
    expect(jobRepo.update).not.toHaveBeenCalled();
  });

  it('does not create pending suggestions or jobs while the user is on a routine break', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T06:00:00.000Z'));
    slotRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        user_id: 'user-1',
        day_of_week: 'wed',
        slot_time: '08:00',
        mode: 'ai',
      } as ScheduleSlot,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    preferenceRepo.find.mockResolvedValue([
      { user_id: 'user-1', suggestion_lead_time_minutes: 120 },
    ] as UserNotificationPreference[]);
    routineBreakService.getActiveUserIds.mockResolvedValue(new Set(['user-1']));

    const result = await scheduler.runOnce();

    expect(result.enqueued).toBe(0);
    expect(suggestionRepo.find).not.toHaveBeenCalled();
    expect(suggestionRepo.save).not.toHaveBeenCalled();
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

function mockSaveArray<T extends ObjectLiteral>(
  repository: Repository<T>,
): jest.Mock<Promise<T[]>, [T[]]> {
  return repository.save as unknown as jest.Mock<Promise<T[]>, [T[]]>;
}
