import { ConfigService } from '@nestjs/config';
import { ObjectLiteral, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { InAppNotification } from '../../notifications/entities/in-app-notification.entity';
import { NotificationsService } from '../../notifications/notifications.service';
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
  const routineBreakService = {
    getActiveUserIds: jest.fn(),
  } as unknown as jest.Mocked<RoutineBreakService>;
  const worker = new SuggestionReminderWorker(
    configService,
    notifications,
    suggestionRepo,
    applicationLogRepo,
    userRepo,
    routineBreakService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T10:00:00.000Z'));
    notifications.dispatch.mockResolvedValue(null as InAppNotification | null);
    routineBreakService.getActiveUserIds.mockResolvedValue(new Set());
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
      }),
    );
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
});

function repo<T extends ObjectLiteral>() {
  return {
    find: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}
