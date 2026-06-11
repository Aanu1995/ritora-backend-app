import { ConfigService } from '@nestjs/config';
import { ObjectLiteral, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { InAppNotification } from '../../notifications/entities/in-app-notification.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { RoutineBreakService } from './routine-break.service';
import { SuggestionReminderWorker } from './suggestion-reminder-worker.service';

describe('SuggestionReminderWorker', () => {
  const configService = {
    get: jest.fn().mockReturnValue('false'),
  } as unknown as ConfigService;
  const notifications = {
    dispatch: jest.fn(),
  } as unknown as jest.Mocked<NotificationsService>;
  const suggestionRepo = repo<SuggestionInstance>();
  const applicationLogRepo = repo<ApplicationLog>();
  const userRepo = repo<User>();
  const slotRepo = repo<ScheduleSlot>();
  const routineBreakService = {
    getActiveUserIds: jest.fn(),
  } as unknown as jest.Mocked<RoutineBreakService>;
  const worker = new SuggestionReminderWorker(
    configService,
    notifications,
    suggestionRepo,
    applicationLogRepo,
    userRepo,
    slotRepo,
    routineBreakService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T10:00:00.000Z'));
    notifications.dispatch.mockResolvedValue(null as InAppNotification | null);
    routineBreakService.getActiveUserIds.mockResolvedValue(new Set());
    slotRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        user_id: 'user-1',
        deleted_at: null,
      } as ScheduleSlot,
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dispatches due reminders through NotificationsService so quiet hours can be persisted', async () => {
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'suggestion-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '08:00',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    applicationLogRepo.find.mockResolvedValue([]);

    const result = await worker.runOnce();

    expect(result).toEqual({ slotStart: 0, recordingReminder: 0 });
    expect(suggestionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          generation_status: 'ready',
          target_date: expect.any(Object),
        }),
        select: [
          'id',
          'user_id',
          'slot_id',
          'request_source',
          'target_date',
          'target_time',
          'generation_status',
        ],
      }),
    );
    expect(slotRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: expect.objectContaining({ _value: ['slot-1'] }),
          deleted_at: expect.objectContaining({ _type: 'isNull' }),
        }),
        select: ['id', 'user_id'],
      }),
    );
    expect(userRepo.find).toHaveBeenCalledWith({
      where: { id: expect.objectContaining({ _value: ['user-1'] }) },
      select: ['id', 'time_zone'],
    });
    expect(applicationLogRepo.find).toHaveBeenCalledWith({
      where: {
        suggestion_instance_id: expect.objectContaining({
          _value: ['suggestion-1'],
        }),
      },
      select: ['suggestion_instance_id'],
    });
    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'slot_start',
        dedupeKey: 'slot_start:suggestion-1',
      }),
    );
    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'recording_reminder',
        dedupeKey: 'recording_reminder:suggestion-1',
      }),
    );
  });

  it('suppresses slot and recording reminders during an active routine break', async () => {
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'suggestion-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '08:00',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    applicationLogRepo.find.mockResolvedValue([]);
    routineBreakService.getActiveUserIds.mockResolvedValue(new Set(['user-1']));

    const result = await worker.runOnce();

    expect(result).toEqual({ slotStart: 0, recordingReminder: 0 });
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('suppresses slot and recording reminders once the suggestion was recorded', async () => {
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'suggestion-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '08:00',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);
    userRepo.find.mockResolvedValue([
      { id: 'user-1', time_zone: 'UTC' } as User,
    ]);
    applicationLogRepo.find.mockResolvedValue([
      { suggestion_instance_id: 'suggestion-1' } as ApplicationLog,
    ]);

    const result = await worker.runOnce();

    expect(result).toEqual({ slotStart: 0, recordingReminder: 0 });
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('does not send scheduled reminders after the schedule slot was deleted', async () => {
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'suggestion-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '08:00',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);
    slotRepo.find.mockResolvedValue([]);

    const result = await worker.runOnce();

    expect(result).toEqual({ slotStart: 0, recordingReminder: 0 });
    expect(userRepo.find).not.toHaveBeenCalled();
    expect(applicationLogRepo.find).not.toHaveBeenCalled();
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('does not send scheduled reminders when the slot belongs to another user', async () => {
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'suggestion-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '08:00',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);
    slotRepo.find.mockResolvedValue([
      {
        id: 'slot-1',
        user_id: 'other-user',
        deleted_at: null,
      } as ScheduleSlot,
    ]);

    const result = await worker.runOnce();

    expect(result).toEqual({ slotStart: 0, recordingReminder: 0 });
    expect(userRepo.find).toHaveBeenCalled();
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('does not send slot-start or recording reminders for on-demand suggestions', async () => {
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'suggestion-on-demand-1',
        user_id: 'user-1',
        slot_id: null,
        request_source: 'on_demand',
        target_date: '2026-04-29',
        target_time: '08:00',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);

    const result = await worker.runOnce();

    expect(result).toEqual({ slotStart: 0, recordingReminder: 0 });
    expect(slotRepo.find).not.toHaveBeenCalled();
    expect(userRepo.find).not.toHaveBeenCalled();
    expect(applicationLogRepo.find).not.toHaveBeenCalled();
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('keeps the worker scheduler alive with a referenced timer', () => {
    jest.useRealTimers();
    const unref = jest.fn();
    const fakeTimer = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutMock = ((..._args: Parameters<typeof setTimeout>) =>
      fakeTimer) as unknown as typeof setTimeout;
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(setTimeoutMock);
    const workerWithTimer = new SuggestionReminderWorker(
      {
        get: jest.fn().mockReturnValue('development'),
      } as unknown as ConfigService,
      notifications,
      suggestionRepo,
      applicationLogRepo,
      userRepo,
      slotRepo,
      routineBreakService,
    );

    try {
      workerWithTimer.onModuleInit();

      expect(setTimeoutSpy).toHaveBeenCalled();
      expect(unref).not.toHaveBeenCalled();
    } finally {
      workerWithTimer.onModuleDestroy();
      setTimeoutSpy.mockRestore();
    }
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    find: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}
