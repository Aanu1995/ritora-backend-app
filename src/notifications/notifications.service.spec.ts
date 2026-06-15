import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { MailUnsubscribeTokenService } from '../mail/mail-unsubscribe-token.service';
import { MailService } from '../mail/mail.service';
import {
  DataProvenance,
  ProductCategory,
  ProductIntroductionStatus,
  ShelfStatus,
} from '../shelf/shelf.types';
import { User } from '../users/entities/user.entity';
import { UserRestrictionEnforcementService } from '../users/user-restriction-enforcement.service';
import { UserRestrictionCapability } from '../users/user-restrictions';
import { PlatformGlobalRestrictionsService } from '../platform-controls/platform-global-restrictions.service';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { InAppNotification } from './entities/in-app-notification.entity';
import { ScheduledNotification } from './entities/scheduled-notification.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';

const repo = () => ({
  create: jest.fn((data) => data),
  createQueryBuilder: jest.fn(),
  delete: jest.fn().mockResolvedValue({ affected: 0 }),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  exists: jest.fn().mockResolvedValue(false),
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

function inventoryProduct(
  overrides: Partial<InventoryProduct> = {},
): InventoryProduct {
  return {
    id: 'product-1',
    user_id: 'user-1',
    brand: 'CeraVe',
    name: 'Retinol Serum',
    category: ProductCategory.Serum,
    barcode: null,
    status: ShelfStatus.Active,
    provenance: DataProvenance.PhotoLookup,
    brand_search: 'cerave',
    name_search: 'retinol serum',
    search_document: 'cerave retinol serum',
    opened_at: new Date('2026-04-01T00:00:00.000Z'),
    expires_at: null,
    period_after_opening_months: 12,
    effective_expires_at: new Date('2026-05-10T00:00:00.000Z'),
    introduction_status: ProductIntroductionStatus.Tolerated,
    introduction_started_at: new Date('2026-04-01T00:00:00.000Z'),
    introduction_status_updated_at: new Date('2026-04-01T00:00:00.000Z'),
    identity: {
      brand: 'CeraVe',
      name: 'Retinol Serum',
      category: ProductCategory.Serum,
      barcode: null,
      imageUrls: [],
      sizeMl: null,
      description: null,
      benefits: [],
      suitedFor: [],
      inciIngredients: [],
      inciLastConfirmedAt: null,
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    manufacturer: {
      brand: 'CeraVe',
      parentCompany: null,
      countryOfOrigin: null,
      countryOfManufacture: null,
      supportEmail: null,
      productUrl: null,
      websiteUrl: null,
    },
    user_fields: {
      openedAt: '2026-04-01T00:00:00.000Z',
      expiresAt: null,
      periodAfterOpeningMonths: 12,
      pricePaid: null,
      pricePaidCurrency: null,
      purchasedFrom: null,
      personalNotes: null,
      preferredTimeOfDay: null,
    },
    created_at: new Date('2026-04-01T00:00:00.000Z'),
    updated_at: new Date('2026-04-01T00:00:00.000Z'),
    user: undefined as never,
    generateId: jest.fn(),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notifications: ReturnType<typeof repo>;
  let scheduledNotifications: ReturnType<typeof repo>;
  let preferences: ReturnType<typeof repo>;
  let users: ReturnType<typeof repo>;
  let entries: ReturnType<typeof repo>;
  let applicationLogs: ReturnType<typeof repo>;
  let inventoryProducts: ReturnType<typeof repo>;
  let notificationQb: ReturnType<typeof notificationQueryBuilder>;
  const mailService = { sendNotificationEmail: jest.fn() };
  const unsubscribeTokens = { verifyToken: jest.fn() };
  const pushNotifications = { sendNotificationPush: jest.fn() };
  const restrictionEnforcement = {
    isCapabilityRestricted: jest.fn(),
    isCapabilityRestrictedForUser: jest.fn(),
  };
  const platformRestrictions = {
    isCapabilityDisabled: jest.fn(),
  };

  beforeEach(async () => {
    notifications = repo();
    notificationQb = notificationQueryBuilder();
    notifications.createQueryBuilder.mockReturnValue(notificationQb);
    scheduledNotifications = repo();
    preferences = repo();
    users = repo();
    entries = repo();
    applicationLogs = repo();
    inventoryProducts = repo();
    mailService.sendNotificationEmail.mockClear();
    mailService.sendNotificationEmail.mockResolvedValue(undefined);
    unsubscribeTokens.verifyToken.mockClear();
    pushNotifications.sendNotificationPush.mockClear();
    pushNotifications.sendNotificationPush.mockResolvedValue(undefined);
    restrictionEnforcement.isCapabilityRestricted.mockClear();
    restrictionEnforcement.isCapabilityRestricted.mockResolvedValue(false);
    restrictionEnforcement.isCapabilityRestrictedForUser.mockClear();
    restrictionEnforcement.isCapabilityRestrictedForUser.mockReturnValue(false);
    platformRestrictions.isCapabilityDisabled.mockClear();
    platformRestrictions.isCapabilityDisabled.mockResolvedValue(false);

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
        {
          provide: getRepositoryToken(ApplicationLog),
          useValue: applicationLogs,
        },
        {
          provide: getRepositoryToken(InventoryProduct),
          useValue: inventoryProducts,
        },
        { provide: MailService, useValue: mailService },
        { provide: MailUnsubscribeTokenService, useValue: unsubscribeTokens },
        { provide: PushNotificationsService, useValue: pushNotifications },
        {
          provide: UserRestrictionEnforcementService,
          useValue: restrictionEnforcement,
        },
        {
          provide: PlatformGlobalRestrictionsService,
          useValue: platformRestrictions,
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  it('drops notification dispatch before preference lookup when globally disabled', async () => {
    platformRestrictions.isCapabilityDisabled.mockResolvedValue(true);

    await expect(
      service.dispatch({
        bodyKey: 'notifications.photoReminder.body',
        kind: 'photo_reminder',
        titleKey: 'notifications.photoReminder.title',
        userId: 'user-1',
      }),
    ).resolves.toBeNull();

    expect(preferences.findOne).not.toHaveBeenCalled();
    expect(notifications.save).not.toHaveBeenCalled();
  });

  it('unsubscribes photo reminders from a signed email token', async () => {
    const prefs = {
      user_id: 'user-1',
      channels: ['in_app', 'email'],
      photo_reminder_enabled: true,
      reaction_alerts_enabled: true,
      simplification_alerts_enabled: true,
      insight_alerts_enabled: true,
      ai_polished_insights_enabled: true,
      wrapped_alerts_enabled: true,
      suggestion_ready_enabled: true,
      slot_start_enabled: true,
      recording_reminder_enabled: true,
      product_expiry_alerts_enabled: true,
      product_expiry_notice_days: 14,
      suggestion_lead_time_minutes: 120,
      quiet_hours_enabled: false,
      quiet_hours_start: '22:30',
      quiet_hours_end: '06:30',
      photo_tutorial_completed: false,
    };
    unsubscribeTokens.verifyToken.mockReturnValue({
      userId: 'user-1',
      kind: 'photo_reminder',
    });
    users.findOne.mockResolvedValue({ id: 'user-1' });
    preferences.findOne.mockResolvedValue(prefs);

    await service.unsubscribeNotificationEmail('signed-token');

    expect(prefs.photo_reminder_enabled).toBe(true);
    expect(prefs.channels).toEqual(['in_app']);
    expect(preferences.save).toHaveBeenCalledWith(
      expect.objectContaining({
        photo_reminder_enabled: true,
        channels: ['in_app'],
      }),
    );
  });

  it('unsubscribes only insight email channels for doctor referral email tokens', async () => {
    const prefs = {
      user_id: 'user-1',
      channels: ['in_app', 'email'],
      insight_alert_channels: ['in_app', 'email'],
      photo_reminder_enabled: true,
      reaction_alerts_enabled: true,
      simplification_alerts_enabled: true,
      insight_alerts_enabled: true,
      ai_polished_insights_enabled: true,
      wrapped_alerts_enabled: true,
      suggestion_ready_enabled: true,
      slot_start_enabled: true,
      recording_reminder_enabled: true,
      product_expiry_alerts_enabled: true,
      product_expiry_notice_days: 14,
      suggestion_lead_time_minutes: 120,
      quiet_hours_enabled: false,
      quiet_hours_start: '22:30',
      quiet_hours_end: '06:30',
      photo_tutorial_completed: false,
    };
    unsubscribeTokens.verifyToken.mockReturnValue({
      userId: 'user-1',
      kind: 'doctor_referral',
    });
    users.findOne.mockResolvedValue({ id: 'user-1' });
    preferences.findOne.mockResolvedValue(prefs);

    await service.unsubscribeNotificationEmail('signed-token');

    expect(prefs.insight_alerts_enabled).toBe(true);
    expect(prefs.insight_alert_channels).toEqual(['in_app']);
    expect(preferences.save).toHaveBeenCalledWith(
      expect.objectContaining({
        insight_alerts_enabled: true,
        insight_alert_channels: ['in_app'],
      }),
    );
  });

  it('treats valid unsubscribe tokens for deleted users as already handled', async () => {
    unsubscribeTokens.verifyToken.mockReturnValue({
      userId: 'deleted-user',
      kind: 'photo_reminder',
    });
    users.findOne.mockResolvedValue(null);

    await service.unsubscribeNotificationEmail('signed-token');

    expect(preferences.findOne).not.toHaveBeenCalled();
    expect(preferences.save).not.toHaveBeenCalled();
  });

  it('rejects invalid unsubscribe tokens without changing preferences', async () => {
    unsubscribeTokens.verifyToken.mockReturnValue(null);

    await expect(
      service.unsubscribeNotificationEmail('bad-token'),
    ).rejects.toThrow('Invalid unsubscribe token');

    expect(preferences.save).not.toHaveBeenCalled();
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

  it('marks an unread notification read with a single conditional update', async () => {
    notifications.update.mockResolvedValue({ affected: 1 });

    await service.markRead('user-1', 'notification-1');

    expect(notifications.update).toHaveBeenCalledWith(
      {
        id: 'notification-1',
        user_id: 'user-1',
        read_at: expect.objectContaining({ _type: 'isNull' }),
      },
      { read_at: expect.any(Date) },
    );
    expect(notifications.findOne).not.toHaveBeenCalled();
    expect(notifications.save).not.toHaveBeenCalled();
  });

  it('checks existence only when mark-read did not update a row', async () => {
    notifications.update.mockResolvedValue({ affected: 0 });
    notifications.exists.mockResolvedValue(false);

    await expect(
      service.markRead('user-1', 'missing-notification'),
    ).rejects.toThrow('Notification not found');

    expect(notifications.exists).toHaveBeenCalledWith({
      where: { id: 'missing-notification', user_id: 'user-1' },
    });
    expect(notifications.findOne).not.toHaveBeenCalled();
    expect(notifications.save).not.toHaveBeenCalled();
  });

  it('purges old read notifications without touching unread or recent rows', async () => {
    notifications.delete
      .mockResolvedValueOnce({ affected: 4 })
      .mockResolvedValueOnce({ affected: 1 });

    const result = await service.runReadNotificationRetentionSweep(
      new Date('2026-05-10T12:00:00.000Z'),
    );

    expect(result).toEqual({ deleted: 5 });
    expect(notifications.delete).toHaveBeenCalledTimes(2);
    expect(notifications.delete).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: expect.any(Object),
        read_at: expect.any(Object),
      }),
    );
    expect(notifications.delete).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: expect.any(Object),
        read_at: expect.any(Object),
      }),
    );
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

  it('creates new notification preferences with email disabled by default', async () => {
    preferences.findOne.mockResolvedValue(null);
    preferences.save.mockImplementation(async (value) => value);

    const result = await service.getPreferences('new-user');

    expect(preferences.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'new-user',
        channels: ['in_app'],
      }),
    );
    expect(result.channels).toEqual(['in_app']);
    expect(result.suggestion_ready_channels).toEqual(['in_app']);
    expect(result.reaction_alert_channels).toEqual(['in_app']);
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
      suggestion_ready_channels: ['in_app'],
      slot_start_enabled: false,
      slot_start_channels: ['email'],
      recording_reminder_enabled: false,
      recording_reminder_channels: ['in_app', 'push'],
      suggestion_lead_time_minutes: 360,
      quiet_hours_enabled: true,
      quiet_hours_start: '21:00',
      quiet_hours_end: '07:00',
    });

    expect(preferences.save).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion_ready_enabled: false,
        suggestion_ready_channels: ['in_app'],
        slot_start_enabled: false,
        slot_start_channels: ['email'],
        recording_reminder_enabled: false,
        recording_reminder_channels: ['in_app', 'push'],
        suggestion_lead_time_minutes: 360,
        quiet_hours_enabled: true,
        quiet_hours_start: '21:00',
        quiet_hours_end: '07:00',
      }),
    );
  });

  it('persists product expiry alert preferences from the API', async () => {
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
      product_expiry_alerts_enabled: true,
      product_expiry_notice_days: 14,
      suggestion_lead_time_minutes: 120,
      quiet_hours_enabled: false,
      quiet_hours_start: '22:30',
      quiet_hours_end: '06:30',
    });
    preferences.save.mockImplementation(async (value) => value);

    const result = await service.updatePreferences('user-1', {
      product_expiry_alerts_enabled: false,
      product_expiry_notice_days: 30,
    });

    expect(preferences.save).toHaveBeenCalledWith(
      expect.objectContaining({
        product_expiry_alerts_enabled: false,
        product_expiry_notice_days: 30,
      }),
    );
    expect(result.product_expiry_alerts_enabled).toBe(false);
    expect(result.product_expiry_notice_days).toBe(30);
  });

  it('persists Smart Picks notification preferences from the API', async () => {
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
      smart_pick_ready_enabled: false,
      slot_start_enabled: true,
      recording_reminder_enabled: true,
      product_expiry_alerts_enabled: true,
      product_expiry_notice_days: 14,
      suggestion_lead_time_minutes: 120,
      quiet_hours_enabled: false,
      quiet_hours_start: '22:30',
      quiet_hours_end: '06:30',
    });
    preferences.save.mockImplementation(async (value) => value);

    const result = await service.updatePreferences('user-1', {
      smart_pick_ready_enabled: true,
      smart_pick_ready_channels: ['in_app', 'push'],
    });

    expect(preferences.save).toHaveBeenCalledWith(
      expect.objectContaining({
        smart_pick_ready_enabled: true,
        smart_pick_ready_channels: ['in_app', 'push'],
      }),
    );
    expect(result.smart_pick_ready_enabled).toBe(true);
    expect(result.smart_pick_ready_channels).toEqual(['in_app']);
  });

  it('returns per-notification channels with legacy channels as the fallback', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app'],
      reaction_alert_channels: ['email'],
      simplification_alert_channels: null,
      insight_alert_channels: ['in_app', 'email'],
      wrapped_alert_channels: ['push'],
      suggestion_ready_channels: ['in_app', 'push'],
      slot_start_channels: ['email'],
      recording_reminder_channels: ['in_app'],
      smart_pick_ready_channels: null,
      product_expiry_alert_channels: ['push'],
      photo_reminder_local_time: '08:00:00',
      photo_reminder_enabled: true,
      reaction_alerts_enabled: true,
      simplification_alerts_enabled: true,
      insight_alerts_enabled: true,
      ai_polished_insights_enabled: true,
      wrapped_alerts_enabled: true,
      smart_pick_ready_enabled: false,
      product_expiry_alerts_enabled: true,
      product_expiry_notice_days: 14,
      photo_tutorial_completed: false,
    });

    const result = await service.getPreferences('user-1');

    expect(result.channels).toEqual(['in_app']);
    expect(result.reaction_alert_channels).toEqual(['email']);
    expect(result.simplification_alert_channels).toEqual(['in_app']);
    expect(result.insight_alert_channels).toEqual(['in_app', 'email']);
    expect(result.wrapped_alert_channels).toEqual([]);
    expect(result.suggestion_ready_channels).toEqual(['in_app']);
    expect(result.slot_start_channels).toEqual(['email']);
    expect(result.recording_reminder_channels).toEqual(['in_app']);
    expect(result.smart_pick_ready_channels).toEqual(['in_app']);
    expect(result.product_expiry_alert_channels).toEqual([]);
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
    expect(pushNotifications.sendNotificationPush).not.toHaveBeenCalled();
  });

  it('uses notification-specific channels when dispatching emails', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app', 'email'],
      suggestion_ready_channels: ['in_app'],
      suggestion_ready_enabled: true,
      quiet_hours_enabled: false,
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      preferred_language: 'en',
    });

    await service.dispatch({
      userId: 'user-1',
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
    });

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        kind: 'suggestion_ready',
      }),
    );
    expect(mailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('does not send notification-specific push when the global push channel is off', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app'],
      suggestion_ready_channels: ['in_app', 'push'],
      suggestion_ready_enabled: true,
      quiet_hours_enabled: false,
    });

    await service.dispatch({
      userId: 'user-1',
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
    });

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        kind: 'suggestion_ready',
      }),
    );
    expect(pushNotifications.sendNotificationPush).not.toHaveBeenCalled();
  });

  it('does not create Smart Picks notifications when the optional gate is disabled', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app'],
      smart_pick_ready_enabled: false,
    });

    const result = await service.dispatch({
      userId: 'user-1',
      kind: 'smart_pick_ready',
      titleKey: 'notificationsPage.kinds.smart_pick_ready.title',
      bodyKey: 'notificationsPage.kinds.smart_pick_ready.body',
      deepLink: '/smart-picks',
    });

    expect(result).toBeNull();
    expect(notifications.save).not.toHaveBeenCalled();
  });

  it('sends product expiry notifications through push and never email', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app', 'email', 'push'],
      product_expiry_alerts_enabled: true,
      quiet_hours_enabled: false,
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      time_zone: 'UTC',
    });

    await service.dispatch({
      userId: 'user-1',
      kind: 'product_nearing_expiry',
      titleKey: 'notificationsPage.kinds.product_nearing_expiry.title',
      bodyKey: 'notificationsPage.kinds.product_nearing_expiry.body',
      severity: 'warning',
    });

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'product_nearing_expiry' }),
    );
    expect(pushNotifications.sendNotificationPush).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        kind: 'product_nearing_expiry',
      }),
    );
    expect(mailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('keeps a product expiry in-app dedupe record even when global in-app is disabled', async () => {
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['push'],
      product_expiry_alerts_enabled: true,
      quiet_hours_enabled: false,
    });
    notifications.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'existing-expiry',
      user_id: 'user-1',
      kind: 'product_nearing_expiry',
      dedupe_key: 'product_nearing_expiry:product-1:2026-05-10',
    });

    await service.dispatch({
      userId: 'user-1',
      kind: 'product_nearing_expiry',
      titleKey: 'notificationsPage.kinds.product_nearing_expiry.title',
      bodyKey: 'notificationsPage.kinds.product_nearing_expiry.body',
      dedupeKey: 'product_nearing_expiry:product-1:2026-05-10',
    });

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'product_nearing_expiry',
        dedupe_key: 'product_nearing_expiry:product-1:2026-05-10',
      }),
    );
    expect(pushNotifications.sendNotificationPush).toHaveBeenCalledTimes(1);

    notifications.save.mockClear();
    pushNotifications.sendNotificationPush.mockClear();

    await service.dispatch({
      userId: 'user-1',
      kind: 'product_nearing_expiry',
      titleKey: 'notificationsPage.kinds.product_nearing_expiry.title',
      bodyKey: 'notificationsPage.kinds.product_nearing_expiry.body',
      dedupeKey: 'product_nearing_expiry:product-1:2026-05-10',
    });

    expect(notifications.save).not.toHaveBeenCalled();
    expect(pushNotifications.sendNotificationPush).not.toHaveBeenCalled();
    expect(mailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('creates a nearing-expiry notification within the user notice window', async () => {
    inventoryProducts.findOne.mockResolvedValue(
      inventoryProduct({
        effective_expires_at: new Date('2026-05-10T00:00:00.000Z'),
      }),
    );
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app', 'email', 'push'],
      product_expiry_alerts_enabled: true,
      product_expiry_notice_days: 14,
      quiet_hours_enabled: false,
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      time_zone: 'UTC',
    });
    notifications.findOne.mockResolvedValue(null);

    await service.runProductExpiryAlertForProduct(
      'user-1',
      'product-1',
      new Date('2026-05-01T09:00:00.000Z'),
    );

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        kind: 'product_nearing_expiry',
        severity: 'warning',
        dedupe_key: 'product_nearing_expiry:product-1:2026-05-10',
        deep_link: '/shelf/product-1',
        payload: expect.objectContaining({
          productId: 'product-1',
          daysUntilExpiry: 9,
          noticeDays: 14,
        }),
      }),
    );
    expect(mailService.sendNotificationEmail).not.toHaveBeenCalled();
    expect(pushNotifications.sendNotificationPush).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        kind: 'product_nearing_expiry',
        deepLink: '/shelf/product-1',
      }),
    );
    expect(
      restrictionEnforcement.isCapabilityRestrictedForUser,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      UserRestrictionCapability.DisableNotifications,
    );
    expect(
      restrictionEnforcement.isCapabilityRestricted,
    ).not.toHaveBeenCalled();
  });

  it('keeps product expiry alerts immediate during quiet hours', async () => {
    inventoryProducts.findOne.mockResolvedValue(
      inventoryProduct({
        effective_expires_at: new Date('2026-05-10T00:00:00.000Z'),
      }),
    );
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app'],
      product_expiry_alerts_enabled: true,
      product_expiry_notice_days: 14,
      quiet_hours_enabled: true,
      quiet_hours_start: '00:00',
      quiet_hours_end: '23:59',
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      time_zone: 'UTC',
    });
    notifications.findOne.mockResolvedValue(null);

    await service.runProductExpiryAlertForProduct(
      'user-1',
      'product-1',
      new Date('2026-05-01T09:00:00.000Z'),
    );

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'product_nearing_expiry' }),
    );
    expect(scheduledNotifications.save).not.toHaveBeenCalled();
  });

  it('creates an expired notification once the product reaches expiry', async () => {
    inventoryProducts.findOne.mockResolvedValue(
      inventoryProduct({
        effective_expires_at: new Date('2026-05-01T00:00:00.000Z'),
      }),
    );
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app'],
      product_expiry_alerts_enabled: true,
      product_expiry_notice_days: 14,
      quiet_hours_enabled: false,
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      time_zone: 'UTC',
    });
    notifications.findOne.mockResolvedValue(null);

    await service.runProductExpiryAlertForProduct(
      'user-1',
      'product-1',
      new Date('2026-05-01T09:00:00.000Z'),
    );

    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'product_expired',
        severity: 'critical',
        dedupe_key: 'product_expired:product-1:2026-05-01',
      }),
    );
  });

  it('skips products that are inactive or missing expiry data', async () => {
    inventoryProducts.findOne.mockResolvedValue(
      inventoryProduct({
        status: ShelfStatus.Archived,
        effective_expires_at: new Date('2026-05-01T00:00:00.000Z'),
      }),
    );
    preferences.findOne.mockResolvedValue({
      user_id: 'user-1',
      channels: ['in_app'],
      product_expiry_alerts_enabled: true,
      product_expiry_notice_days: 14,
    });
    users.findOne.mockResolvedValue({
      id: 'user-1',
      time_zone: 'UTC',
    });

    const result = await service.runProductExpiryAlertForProduct(
      'user-1',
      'product-1',
      new Date('2026-05-01T09:00:00.000Z'),
    );

    expect(result).toBeNull();
    expect(notifications.save).not.toHaveBeenCalled();
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

  it('cancels delayed routine reminders once the suggestion was recorded', async () => {
    scheduledNotifications.find.mockResolvedValue([
      {
        id: 'scheduled-1',
        user_id: 'user-1',
        kind: 'slot_start',
        title_key: 'notificationsPage.kinds.slot_start.title',
        body_key: 'notificationsPage.kinds.slot_start.body',
        severity: 'info',
        payload: { suggestionId: 'suggestion-1', slotId: 'slot-1' },
        deep_link: '/todays-suggestion',
        dedupe_key: 'slot_start:suggestion-1',
        attempt_count: 0,
      },
    ]);
    applicationLogs.exists.mockResolvedValue(true);

    const result = await service.runScheduledNotificationSweep(
      new Date('2026-04-30T06:00:00.000Z'),
    );

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(applicationLogs.exists).toHaveBeenCalledWith({
      where: {
        user_id: 'user-1',
        suggestion_instance_id: 'suggestion-1',
      },
    });
    expect(scheduledNotifications.update).toHaveBeenCalledWith(
      { id: 'scheduled-1' },
      { status: 'cancelled', last_error: null, locked_at: null },
    );
    expect(notifications.save).not.toHaveBeenCalled();
    expect(preferences.findOne).not.toHaveBeenCalled();
  });

  it('cancels delayed photo reminders once the user uploaded that day', async () => {
    scheduledNotifications.find.mockResolvedValue([
      {
        id: 'scheduled-1',
        user_id: 'user-1',
        kind: 'photo_reminder',
        title_key: 'skinJournal.notifications.photoReminder.title',
        body_key: 'skinJournal.notifications.photoReminder.body',
        severity: 'info',
        payload: { entry_date: '2026-04-29' },
        deep_link: '/journal/upload',
        dedupe_key: 'photo_reminder:2026-04-29',
        attempt_count: 0,
      },
    ]);
    entries.exists.mockResolvedValue(true);

    const result = await service.runScheduledNotificationSweep(
      new Date('2026-04-30T06:00:00.000Z'),
    );

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(entries.exists).toHaveBeenCalledWith({
      where: {
        user_id: 'user-1',
        entry_date: '2026-04-29',
        photo_object_key: expect.objectContaining({ _type: 'not' }),
      },
    });
    expect(scheduledNotifications.update).toHaveBeenCalledWith(
      { id: 'scheduled-1' },
      { status: 'cancelled', last_error: null, locked_at: null },
    );
    expect(notifications.save).not.toHaveBeenCalled();
    expect(preferences.findOne).not.toHaveBeenCalled();
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

    expect(entries.count).toHaveBeenCalledWith({
      where: {
        user_id: 'user-1',
        entry_date: '2026-04-29',
        photo_object_key: expect.objectContaining({ _type: 'not' }),
      },
    });
    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'photo_reminder',
        user_id: 'user-1',
        dedupe_key: 'photo_reminder:2026-04-29',
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
        dedupe_key: 'photo_reminder:2026-04-29',
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
