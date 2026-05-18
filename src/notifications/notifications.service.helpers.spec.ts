import { Repository } from 'typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import {
  DataProvenance,
  ProductCategory,
  ShelfStatus,
} from '../shelf/shelf.types';
import { User } from '../users/entities/user.entity';
import { UpdatePreferencesDto } from './dto/notification-preference.dto';
import { InAppNotification } from './entities/in-app-notification.entity';
import { ScheduledNotification } from './entities/scheduled-notification.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import {
  applyPreferenceUpdates,
  buildProductExpiryDispatchParams,
  canSendNotificationEmail,
  clampInteger,
  isNotificationKindEnabled,
  isUniqueConstraintError,
  normalizeProductExpiryNoticeDays,
  requiresNotificationInApp,
  requiresNotificationPush,
  runReadNotificationRetentionSweep,
  scheduleAfterQuietHours,
} from './notifications.service.helpers';

function prefs(
  overrides: Partial<UserNotificationPreference> = {},
): UserNotificationPreference {
  return {
    id: 'pref-1',
    user_id: 'user-1',
    photo_reminder_local_time: '20:30',
    photo_reminder_enabled: true,
    channels: ['in_app', 'email'],
    reaction_alerts_enabled: true,
    simplification_alerts_enabled: true,
    insight_alerts_enabled: true,
    ai_polished_insights_enabled: true,
    insight_cadence: 'weekly',
    insight_digest_day: 1,
    insight_digest_local_time: '09:00',
    wrapped_alerts_enabled: true,
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
    photo_tutorial_completed: false,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    user: null as unknown as User,
    generateId: jest.fn(),
    ...overrides,
  };
}

function product(overrides: Partial<InventoryProduct> = {}): InventoryProduct {
  return {
    id: 'product-1',
    user_id: 'user-1',
    brand: 'Ritora',
    name: 'Barrier Cream',
    category: ProductCategory.Moisturizer,
    barcode: null,
    status: ShelfStatus.Active,
    provenance: DataProvenance.PhotoLookup,
    brand_search: 'ritora',
    name_search: 'barrier cream',
    search_document: 'ritora barrier cream',
    opened_at: null,
    expires_at: null,
    period_after_opening_months: null,
    effective_expires_at: new Date('2026-05-10T00:00:00.000Z'),
    identity: {} as InventoryProduct['identity'],
    guidance: {} as InventoryProduct['guidance'],
    manufacturer: {} as InventoryProduct['manufacturer'],
    user_fields: {} as InventoryProduct['user_fields'],
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    user: null as unknown as User,
    generateId: jest.fn(),
    ...overrides,
  };
}

describe('notification helper policies', () => {
  it.each([
    ['photo_reminder', 'photo_reminder_enabled'],
    ['reaction_detected', 'reaction_alerts_enabled'],
    ['simplification_started', 'simplification_alerts_enabled'],
    ['insight_ready', 'insight_alerts_enabled'],
    ['doctor_referral', 'insight_alerts_enabled'],
    ['wrapped_ready', 'wrapped_alerts_enabled'],
    ['suggestion_ready', 'suggestion_ready_enabled'],
    ['slot_start', 'slot_start_enabled'],
    ['recording_reminder', 'recording_reminder_enabled'],
    ['product_nearing_expiry', 'product_expiry_alerts_enabled'],
    ['product_expired', 'product_expiry_alerts_enabled'],
  ] as const)('checks preference gate for %s', (kind, field) => {
    expect(isNotificationKindEnabled(prefs({ [field]: false }), kind)).toBe(
      false,
    );
    expect(isNotificationKindEnabled(prefs({ [field]: true }), kind)).toBe(
      true,
    );
  });

  it('keeps Smart Picks ready alerts opt-in and leaves unknown kinds enabled', () => {
    expect(isNotificationKindEnabled(prefs(), 'smart_pick_ready')).toBe(false);
    expect(
      isNotificationKindEnabled(
        prefs({ smart_pick_ready_enabled: true }),
        'smart_pick_ready',
      ),
    ).toBe(true);
    expect(isNotificationKindEnabled(prefs(), 'analysis_failed')).toBe(true);
  });

  it('identifies email, forced in-app, and forced push notification kinds', () => {
    expect(canSendNotificationEmail('photo_reminder')).toBe(true);
    expect(canSendNotificationEmail('smart_pick_ready')).toBe(false);
    expect(requiresNotificationInApp('product_expired')).toBe(true);
    expect(requiresNotificationInApp('photo_reminder')).toBe(false);
    expect(requiresNotificationPush('product_nearing_expiry')).toBe(true);
    expect(requiresNotificationPush('suggestion_ready')).toBe(false);
  });

  it('normalizes configurable integer bounds safely', () => {
    expect(normalizeProductExpiryNoticeDays(null)).toBe(14);
    expect(normalizeProductExpiryNoticeDays(0)).toBe(1);
    expect(normalizeProductExpiryNoticeDays(100)).toBe(90);
    expect(normalizeProductExpiryNoticeDays(21)).toBe(21);
    expect(normalizeProductExpiryNoticeDays(1.5)).toBe(14);
    expect(clampInteger(5, 1, 10)).toBe(5);
    expect(clampInteger(0, 1, 10)).toBe(1);
    expect(clampInteger(11, 1, 10)).toBe(10);
    expect(clampInteger(1.5, 1, 10)).toBe(1);
  });
});

describe('product expiry notification helpers', () => {
  const now = new Date('2026-05-04T10:00:00.000Z');

  it('builds critical expired notifications and warning nearing-expiry notifications', () => {
    expect(
      buildProductExpiryDispatchParams({
        product: product({
          effective_expires_at: new Date('2026-05-03T00:00:00.000Z'),
        }),
        prefs: prefs({ product_expiry_notice_days: 14 }),
        user: { time_zone: 'Europe/Stockholm' } as User,
        now,
      }),
    ).toMatchObject({
      kind: 'product_expired',
      severity: 'critical',
      payload: {
        productName: 'Ritora Barrier Cream',
        daysUntilExpiry: -1,
        noticeDays: 14,
      },
      bypassQuietHours: true,
      forcePush: true,
    });

    expect(
      buildProductExpiryDispatchParams({
        product: product({
          effective_expires_at: new Date('2026-05-10T00:00:00.000Z'),
        }),
        prefs: prefs({ product_expiry_notice_days: 7 }),
        user: null,
        now,
      }),
    ).toMatchObject({
      kind: 'product_nearing_expiry',
      severity: 'warning',
      deepLink: '/shelf/product-1',
      dedupeKey: 'product_nearing_expiry:product-1:2026-05-10',
    });
  });

  it('skips expiry notifications when product or timing evidence is not eligible', () => {
    expect(
      buildProductExpiryDispatchParams({
        product: product({ status: ShelfStatus.Archived }),
        prefs: prefs(),
        user: null,
        now,
      }),
    ).toBeNull();
    expect(
      buildProductExpiryDispatchParams({
        product: product({ effective_expires_at: null }),
        prefs: prefs(),
        user: null,
        now,
      }),
    ).toBeNull();
    expect(
      buildProductExpiryDispatchParams({
        product: product({
          effective_expires_at: new Date('2026-08-10T00:00:00.000Z'),
        }),
        prefs: prefs({ product_expiry_notice_days: 7 }),
        user: null,
        now,
      }),
    ).toBeNull();
  });
});

describe('notification persistence helpers', () => {
  it('applies partial preference updates without mutating omitted fields', () => {
    const current = prefs();
    const dto: UpdatePreferencesDto = {
      photo_reminder_local_time: '21:00',
      photo_reminder_enabled: false,
      channels: ['push'],
      reaction_alerts_enabled: false,
      simplification_alerts_enabled: false,
      insight_alerts_enabled: false,
      insight_cadence: 'fewer',
      insight_digest_day: 5,
      insight_digest_local_time: '14:30',
      wrapped_alerts_enabled: false,
      photo_tutorial_completed: true,
      suggestion_ready_enabled: false,
      smart_pick_ready_enabled: true,
      slot_start_enabled: false,
      recording_reminder_enabled: false,
      product_expiry_alerts_enabled: false,
      product_expiry_notice_days: 21,
      suggestion_lead_time_minutes: 60,
      quiet_hours_enabled: true,
      quiet_hours_start: '23:00',
      quiet_hours_end: '07:00',
    };

    applyPreferenceUpdates(current, dto);

    expect(current).toMatchObject(dto);
  });

  it('schedules notifications after quiet hours and ignores duplicate dedupe rows', async () => {
    const created = { id: 'scheduled-1' } as ScheduledNotification;
    const repo = {
      create: jest.fn(() => created),
      save: jest.fn().mockResolvedValue(created),
    } as unknown as Repository<ScheduledNotification>;

    await scheduleAfterQuietHours(
      {
        userId: 'user-1',
        kind: 'smart_pick_ready',
        titleKey: 'title',
        bodyKey: 'body',
        payload: { gapCount: 1 },
        deepLink: '/smart-picks',
        dedupeKey: 'smart-pick-1',
      },
      prefs({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' }),
      { time_zone: 'Europe/Stockholm' } as User,
      new Date('2026-05-04T21:30:00.000Z'),
      repo,
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        kind: 'smart_pick_ready',
        payload: { gapCount: 1 },
        deep_link: '/smart-picks',
        status: 'pending',
      }),
    );
    expect(repo.save).toHaveBeenCalledWith(created);

    const duplicateRepo = {
      create: jest.fn(() => created),
      save: jest.fn().mockRejectedValue({ code: '23505' }),
    } as unknown as Repository<ScheduledNotification>;
    await expect(
      scheduleAfterQuietHours(
        {
          userId: 'user-1',
          kind: 'smart_pick_ready',
          titleKey: 'title',
          bodyKey: 'body',
          dedupeKey: 'smart-pick-1',
        },
        prefs(),
        null,
        new Date('2026-05-04T21:30:00.000Z'),
        duplicateRepo,
      ),
    ).resolves.toBeUndefined();
  });

  it('propagates non-duplicate scheduling errors and detects unique violations', async () => {
    expect(isUniqueConstraintError({ code: '23505' })).toBe(true);
    expect(isUniqueConstraintError({ code: 'other' })).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);

    const repo = {
      create: jest.fn(() => ({ id: 'scheduled-1' })),
      save: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as Repository<ScheduledNotification>;

    await expect(
      scheduleAfterQuietHours(
        {
          userId: 'user-1',
          kind: 'smart_pick_ready',
          titleKey: 'title',
          bodyKey: 'body',
        },
        prefs(),
        null,
        new Date('2026-05-04T21:30:00.000Z'),
        repo,
      ),
    ).rejects.toThrow('db down');
  });

  it('sweeps read notification retention using standard and safety windows', async () => {
    const notifications = {
      delete: jest
        .fn()
        .mockResolvedValueOnce({ affected: 3 })
        .mockResolvedValueOnce({ affected: null }),
    } as unknown as Repository<InAppNotification>;

    await expect(
      runReadNotificationRetentionSweep(
        { notifications },
        new Date('2026-05-04T10:00:00.000Z'),
      ),
    ).resolves.toEqual({ deleted: 3 });
    expect(notifications.delete).toHaveBeenCalledTimes(2);
  });
});
