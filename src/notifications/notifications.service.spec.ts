import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { InAppNotification } from './entities/in-app-notification.entity';
import { ScheduledNotification } from './entities/scheduled-notification.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import { NotificationsService } from './notifications.service';

const repo = () => ({
  create: jest.fn((data) => data),
  createQueryBuilder: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn(async (data) => data),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  count: jest.fn().mockResolvedValue(0),
});

const notificationQueryBuilder = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
});

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notifications: ReturnType<typeof repo>;
  let scheduledNotifications: ReturnType<typeof repo>;
  let preferences: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let entries: ReturnType<typeof repo>;
  let notificationQb: ReturnType<typeof notificationQueryBuilder>;
  const mailService = { sendNotificationEmail: jest.fn() };

  beforeEach(async () => {
    notifications = repo();
    notificationQb = notificationQueryBuilder();
    notifications.createQueryBuilder.mockReturnValue(notificationQb);
    scheduledNotifications = repo();
    preferences = repo();
    users = repo();
    entries = repo();
    mailService.sendNotificationEmail.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(InAppNotification),
          useValue: notifications,
        },
        {
          provide: getRepositoryToken(ScheduledNotification),
          useValue: scheduledNotifications,
        },
        {
          provide: getRepositoryToken(UserNotificationPreference),
          useValue: preferences,
        },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(SkinJournalEntry), useValue: entries },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  it('returns the first cursor page using the same pagination shape as shelf', async () => {
    notificationQb.getMany.mockResolvedValue([
      {
        id: 'unread-1',
        read_at: null,
        created_at: new Date('2026-04-29T08:00:00.000Z'),
      },
    ]);
    notifications.count.mockResolvedValue(12);

    const result = await service.list('user-1');

    expect(notifications.createQueryBuilder).toHaveBeenCalledWith(
      'notification',
    );
    expect(notificationQb.where).toHaveBeenCalledWith(
      'notification.user_id = :userId',
      { userId: 'user-1' },
    );
    expect(notificationQb.take).toHaveBeenCalledWith(21);
    expect(notifications.count).toHaveBeenCalledWith({
      where: { user_id: 'user-1', read_at: expect.any(Object) },
    });
    expect(result.unread_count).toBe(12);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('returns a next cursor when more notifications are available', async () => {
    notificationQb.getMany.mockResolvedValue([
      {
        id: 'unread-1',
        read_at: null,
        created_at: new Date('2026-04-29T08:00:00.000Z'),
      },
      {
        id: 'read-1',
        read_at: new Date('2026-04-29T09:00:00.000Z'),
        created_at: new Date('2026-04-28T08:00:00.000Z'),
      },
      {
        id: 'read-2',
        read_at: new Date('2026-04-28T09:00:00.000Z'),
        created_at: new Date('2026-04-27T08:00:00.000Z'),
      },
    ]);
    notifications.count.mockResolvedValue(1);

    const result = await service.list('user-1', { limit: 2 });

    expect(notificationQb.take).toHaveBeenCalledWith(3);
    expect(result.items.map((item) => item.id)).toEqual(['unread-1', 'read-1']);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it('dispatches in-app notifications and attempts email when enabled', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app', 'email'],
      reaction_alerts_enabled: true,
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      preferred_language: 'en',
    });

    await service.dispatch({
      userId: 'user-1',
      kind: 'reaction_detected',
      titleKey: 'skinJournal.notifications.reaction.title',
      bodyKey: 'skinJournal.notifications.reaction.body',
      severity: 'warning',
      deepLink: '/journal',
    });

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        kind: 'reaction_detected',
        deep_link: '/journal',
      }),
    );
    expect(mailService.sendNotificationEmail).toHaveBeenCalled();
  });

  it('allows users to disable every notification channel', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app', 'email'],
      photo_reminder_local_time: '08:00',
      photo_reminder_enabled: true,
      reaction_alerts_enabled: true,
      simplification_alerts_enabled: true,
      insight_alerts_enabled: true,
      ai_polished_insights_enabled: true,
      wrapped_alerts_enabled: true,
      photo_tutorial_completed: false,
    });
    preferences.save.mockImplementation(async (value) => value);

    const result = await service.updatePreferences('user-1', { channels: [] });

    expect(preferences.save).toHaveBeenCalledWith(
      expect.objectContaining({ channels: [] }),
    );
    expect(result.channels).toEqual([]);
  });

  it('persists suggestion and quiet-hour preferences from the API', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app'],
      photo_reminder_local_time: '08:00',
      photo_reminder_enabled: true,
      reaction_alerts_enabled: true,
      simplification_alerts_enabled: true,
      insight_alerts_enabled: true,
      ai_polished_insights_enabled: true,
      wrapped_alerts_enabled: true,
      photo_tutorial_completed: false,
      suggestion_ready_enabled: true,
      slot_start_enabled: true,
      recording_reminder_enabled: true,
      suggestion_lead_time_minutes: 120,
      quiet_hours_enabled: false,
      quiet_hours_start: '22:30',
      quiet_hours_end: '06:30',
    });
    preferences.save.mockImplementation(async (value) => value);

    await service.updatePreferences('user-1', {
      suggestion_ready_enabled: false,
      slot_start_enabled: false,
      recording_reminder_enabled: false,
      suggestion_lead_time_minutes: 360,
      quiet_hours_enabled: true,
      quiet_hours_start: '21:00',
      quiet_hours_end: '07:00',
    });

    expect(preferences.save).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion_ready_enabled: false,
        slot_start_enabled: false,
        recording_reminder_enabled: false,
        suggestion_lead_time_minutes: 360,
        quiet_hours_enabled: true,
        quiet_hours_start: '21:00',
        quiet_hours_end: '07:00',
      }),
    );
  });

  it('normalizes database time values to HH:mm for the preferences API', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app', 'email'],
      photo_reminder_local_time: '08:00:00',
      photo_reminder_enabled: true,
      reaction_alerts_enabled: true,
      simplification_alerts_enabled: true,
      insight_alerts_enabled: true,
      ai_polished_insights_enabled: true,
      wrapped_alerts_enabled: true,
      photo_tutorial_completed: false,
    });

    const result = await service.getPreferences('user-1');

    expect(result.photo_reminder_local_time).toBe('08:00');
  });

  it('does not create notifications when all channels are disabled', async () => {
    mailService.sendNotificationEmail.mockClear();
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: [],
      reaction_alerts_enabled: true,
    });

    const result = await service.dispatch({
      userId: 'user-1',
      kind: 'reaction_detected',
      titleKey: 'skinJournal.notifications.reaction.title',
      bodyKey: 'skinJournal.notifications.reaction.body',
    });

    expect(result).toBeNull();
    expect(notifications.save).not.toHaveBeenCalled();
    expect(mailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('uses dedupe keys to avoid repeated polling notifications and emails', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app', 'email'],
      suggestion_ready_enabled: true,
      quiet_hours_enabled: false,
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      time_zone: 'UTC',
    });
    notifications.findOne.mockResolvedValue({
      id: 'existing',
      user_id: 'user-1',
      kind: 'suggestion_ready',
      dedupe_key: 'suggestion_ready:slot-1',
    });

    const result = await service.dispatch({
      userId: 'user-1',
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
      dedupeKey: 'suggestion_ready:slot-1',
    });

    expect(result?.id).toBe('existing');
    expect(notifications.save).not.toHaveBeenCalled();
    expect(mailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('delays non-urgent notifications during quiet hours', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T23:00:00.000Z'));
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app'],
      suggestion_ready_enabled: true,
      quiet_hours_enabled: true,
      quiet_hours_start: '22:00',
      quiet_hours_end: '06:00',
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      time_zone: 'UTC',
    });

    const result = await service.dispatch({
      userId: 'user-1',
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
    });

    expect(result).toBeNull();
    expect(notifications.save).not.toHaveBeenCalled();
    expect(scheduledNotifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        kind: 'suggestion_ready',
        deliver_at: new Date('2026-04-30T06:00:00.000Z'),
        status: 'pending',
      }),
    );
    jest.useRealTimers();
  });

  it('replays delayed quiet-hour notifications from the retry queue', async () => {
    scheduledNotifications.find.mockResolvedValue([
      {
        id: 'scheduled-1',
        user_id: 'user-1',
        kind: 'suggestion_ready',
        title_key: 'notificationsPage.kinds.suggestion_ready.title',
        body_key: 'notificationsPage.kinds.suggestion_ready.body',
        severity: 'info',
        payload: { slotId: 'slot-1' },
        deep_link: '/todays-suggestion',
        dedupe_key: 'suggestion_ready:2026-04-29:slot-1',
        attempt_count: 0,
      },
    ]);
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app'],
      suggestion_ready_enabled: true,
      quiet_hours_enabled: true,
      quiet_hours_start: '22:00',
      quiet_hours_end: '06:00',
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      time_zone: 'UTC',
    });
    notifications.findOne.mockResolvedValue(null);

    const result = await service.runScheduledNotificationSweep(
      new Date('2026-04-30T06:00:00.000Z'),
    );

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        kind: 'suggestion_ready',
        dedupe_key: 'suggestion_ready:2026-04-29:slot-1',
      }),
    );
    expect(scheduledNotifications.update).toHaveBeenCalledWith(
      { id: 'scheduled-1' },
      { status: 'sent', last_error: null },
    );
  });

  it('does not dispatch a delayed notification when another worker already claimed it', async () => {
    scheduledNotifications.find.mockResolvedValue([
      {
        id: 'scheduled-1',
        user_id: 'user-1',
        kind: 'suggestion_ready',
        title_key: 'notificationsPage.kinds.suggestion_ready.title',
        body_key: 'notificationsPage.kinds.suggestion_ready.body',
        severity: 'info',
        payload: { slotId: 'slot-1' },
        deep_link: '/todays-suggestion',
        dedupe_key: 'suggestion_ready:2026-04-29:slot-1',
        attempt_count: 0,
      },
    ]);
    scheduledNotifications.update.mockResolvedValueOnce({ affected: 0 });

    const result = await service.runScheduledNotificationSweep(
      new Date('2026-04-30T06:00:00.000Z'),
    );

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(notifications.save).not.toHaveBeenCalled();
    expect(mailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('recovers when preference creation races with another request', async () => {
    const duplicateError = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });
    preferences.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      user_id: 'user-1',
      channels: ['in_app'],
      reaction_alerts_enabled: true,
    });
    preferences.save.mockRejectedValueOnce(duplicateError);

    await service.dispatch({
      userId: 'user-1',
      kind: 'reaction_detected',
      titleKey: 'skinJournal.notifications.reaction.title',
      bodyKey: 'skinJournal.notifications.reaction.body',
    });

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        kind: 'reaction_detected',
      }),
    );
  });

  it('sends photo reminders only for users missing today in their timezone', async () => {
    preferences.find.mockResolvedValue([
      {
        user_id: 'user-1',
        photo_reminder_enabled: true,
        photo_reminder_local_time: '08:00:00',
        channels: ['in_app'],
      },
    ]);
    users.find.mockResolvedValue([
      {
        id: 'user-1',
        email: 'a@example.com',
        time_zone: 'UTC',
        preferred_language: 'en',
      },
    ]);
    entries.count.mockResolvedValue(0);
    notifications.count.mockResolvedValue(0);

    await service.runPhotoReminderSweep(new Date('2026-04-29T08:05:00.000Z'));

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'photo_reminder',
        user_id: 'user-1',
      }),
    );
    expect(users.find).toHaveBeenCalledTimes(1);
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('deduplicates photo reminders by the user local day instead of the UTC day', async () => {
    preferences.find.mockResolvedValue([
      {
        user_id: 'user-1',
        photo_reminder_enabled: true,
        photo_reminder_local_time: '17:00:00',
        channels: ['in_app'],
      },
    ]);
    users.find.mockResolvedValue([
      {
        id: 'user-1',
        email: 'a@example.com',
        time_zone: 'America/Los_Angeles',
        preferred_language: 'en',
      },
    ]);
    entries.count.mockResolvedValue(0);
    notifications.count.mockResolvedValue(1);

    await service.runPhotoReminderSweep(new Date('2026-04-29T00:05:00.000Z'));

    const createdAt = notifications.count.mock.calls[0]?.[0]?.where
      ?.created_at as { _value?: [Date, Date] };
    expect(createdAt._value?.[0].toISOString()).toBe(
      '2026-04-28T07:00:00.000Z',
    );
    expect(createdAt._value?.[1].toISOString()).toBe(
      '2026-04-29T06:59:59.999Z',
    );
    expect(notifications.save).not.toHaveBeenCalled();
  });

  it('falls back safely when a stored user timezone is invalid', async () => {
    preferences.find.mockResolvedValue([
      {
        user_id: 'user-1',
        photo_reminder_enabled: true,
        photo_reminder_local_time: '08:00:00',
        channels: ['in_app'],
      },
    ]);
    users.find.mockResolvedValue([
      {
        id: 'user-1',
        email: 'a@example.com',
        time_zone: 'Not/AZone',
        preferred_language: 'en',
      },
    ]);
    entries.count.mockResolvedValue(0);
    notifications.count.mockResolvedValue(0);

    await expect(
      service.runPhotoReminderSweep(new Date('2026-04-29T08:05:00.000Z')),
    ).resolves.toBeUndefined();

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'photo_reminder',
        user_id: 'user-1',
      }),
    );
  });

  it('loads photo reminder users once per preference batch', async () => {
    preferences.find.mockResolvedValue([
      {
        user_id: 'user-1',
        photo_reminder_enabled: true,
        photo_reminder_local_time: '08:00:00',
        channels: ['in_app'],
      },
      {
        user_id: 'user-2',
        photo_reminder_enabled: true,
        photo_reminder_local_time: '08:00:00',
        channels: ['in_app'],
      },
    ]);
    users.find.mockResolvedValue([
      {
        id: 'user-1',
        email: 'one@example.com',
        time_zone: 'UTC',
        preferred_language: 'en',
      },
      {
        id: 'user-2',
        email: 'two@example.com',
        time_zone: 'UTC',
        preferred_language: 'en',
      },
    ]);
    entries.count.mockResolvedValue(0);
    notifications.count.mockResolvedValue(0);

    await service.runPhotoReminderSweep(new Date('2026-04-29T08:05:00.000Z'));

    expect(users.find).toHaveBeenCalledTimes(1);
    expect(users.findOne).not.toHaveBeenCalled();
    expect(notifications.save).toHaveBeenCalledTimes(2);
  });
});
