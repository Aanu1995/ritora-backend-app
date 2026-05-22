import {
  Between,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import {
  diffShelfCalendarDays,
  parseShelfPlainDate,
  resolveShelfToday,
} from '../shelf/shelf-date.utils';
import { ShelfStatus } from '../shelf/shelf.types';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import {
  resolveSkinJournalTimeZone,
  todayInTimeZone,
} from '../skin-journal/skin-journal.utils';
import { User } from '../users/entities/user.entity';
import { NOTIFICATION_KIND_TEMPLATE } from '../mail/mail.constants';
import {
  PRODUCT_EXPIRY_NOTICE_DAYS_DEFAULT,
  PRODUCT_EXPIRY_NOTICE_DAYS_MAX,
  PRODUCT_EXPIRY_NOTICE_DAYS_MIN,
  PRODUCT_EXPIRY_SWEEP_BATCH_SIZE,
  NOTIFICATION_READ_RETENTION_DAYS,
  NOTIFICATION_SAFETY_READ_RETENTION_DAYS,
} from './notifications.constants';
import {
  InAppNotification,
  NotificationKind,
  NotificationSeverity,
} from './entities/in-app-notification.entity';
import {
  ScheduledNotification,
  ScheduledNotificationStatus,
  ScheduledNotificationStatusValue,
} from './entities/scheduled-notification.entity';
import {
  DEFAULT_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_VALUES,
  NotificationChannel,
  UserNotificationPreference,
} from './entities/user-notification-preference.entity';
import { UpdatePreferencesDto } from './dto/notification-preference.dto';
import {
  isReminderDue,
  localDayUtcRange,
  nextQuietHoursEligibleInstant,
} from './notification-time.helpers';

export {
  applyNotificationCursor,
  buildNotificationNextCursor,
  notificationCursorFingerprint,
  NOTIFICATION_READ_BUCKET_SQL,
} from './notification-cursor.helpers';
export { isDelayedByQuietHours } from './notification-time.helpers';

export type DispatchNotificationParams = {
  userId: string;
  kind: NotificationKind;
  titleKey: string;
  bodyKey: string;
  severity?: NotificationSeverity;
  payload?: Record<string, unknown>;
  deepLink?: string;
  dedupeKey?: string;
  bypassQuietHours?: boolean;
  forcePush?: boolean;
};

const PHOTO_REMINDER_SWEEP_BATCH_SIZE = 1000;
const SCHEDULED_NOTIFICATION_BATCH_SIZE = 100;
const SCHEDULED_NOTIFICATION_MAX_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_RETENTION_NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'reaction_detected',
  'simplification_started',
  'doctor_referral',
  'product_expired',
];

export type ProductExpiryAlertSweepResult = {
  processed: number;
  dispatched: number;
};

export type NotificationRetentionSweepResult = {
  deleted: number;
};

export type ProductExpiryDispatchInput = {
  product: InventoryProduct;
  prefs: UserNotificationPreference;
  user: User | null;
  now: Date;
};

export async function runPhotoReminderSweep(
  params: {
    preferences: Repository<UserNotificationPreference>;
    users: Repository<User>;
    entries: Repository<SkinJournalEntry>;
    notifications: Repository<InAppNotification>;
    dispatchWithPreferences: (
      params: DispatchNotificationParams,
      prefs: UserNotificationPreference,
      user?: User | null,
    ) => Promise<InAppNotification | null>;
  },
  now: Date,
): Promise<void> {
  let lastUserId: string | null = null;
  while (true) {
    const prefs = await params.preferences.find({
      where: {
        photo_reminder_enabled: true,
        ...(lastUserId ? { user_id: MoreThan(lastUserId) } : {}),
      },
      order: { user_id: 'ASC' },
      take: PHOTO_REMINDER_SWEEP_BATCH_SIZE,
    });
    if (prefs.length === 0) {
      return;
    }
    const usersById = await loadUsersById(
      params.users,
      prefs.map((pref) => pref.user_id),
    );
    for (const pref of prefs) {
      await maybeDispatchPhotoReminder(
        params,
        pref,
        usersById.get(pref.user_id) ?? null,
        now,
      );
    }
    if (prefs.length < PHOTO_REMINDER_SWEEP_BATCH_SIZE) {
      return;
    }
    lastUserId = prefs[prefs.length - 1]?.user_id ?? lastUserId;
  }
}

export async function runScheduledNotificationSweep(
  params: {
    scheduledNotifications: Repository<ScheduledNotification>;
    dispatch: (
      params: DispatchNotificationParams,
    ) => Promise<InAppNotification | null>;
  },
  now: Date,
): Promise<{ sent: number; failed: number }> {
  const due = await params.scheduledNotifications.find({
    where: {
      status: ScheduledNotificationStatusValue.Pending,
      deliver_at: LessThanOrEqual(now),
    },
    order: { deliver_at: 'ASC' },
    take: SCHEDULED_NOTIFICATION_BATCH_SIZE,
  });
  let sent = 0;
  let failed = 0;
  for (const scheduled of due) {
    const claim = await params.scheduledNotifications.update(
      { id: scheduled.id, status: ScheduledNotificationStatusValue.Pending },
      { status: ScheduledNotificationStatusValue.Dispatching, locked_at: now },
    );
    if (!claim.affected) {
      continue;
    }
    try {
      await params.dispatch({
        userId: scheduled.user_id,
        kind: scheduled.kind,
        titleKey: scheduled.title_key,
        bodyKey: scheduled.body_key,
        severity: scheduled.severity,
        payload: scheduled.payload ?? undefined,
        deepLink: scheduled.deep_link ?? undefined,
        dedupeKey: scheduled.dedupe_key ?? undefined,
        bypassQuietHours: true,
      });
      await params.scheduledNotifications.update(
        { id: scheduled.id },
        { status: ScheduledNotificationStatusValue.Sent, last_error: null },
      );
      sent += 1;
    } catch (error) {
      const attemptCount = scheduled.attempt_count + 1;
      const status: ScheduledNotificationStatus =
        attemptCount >= SCHEDULED_NOTIFICATION_MAX_ATTEMPTS
          ? ScheduledNotificationStatusValue.Failed
          : ScheduledNotificationStatusValue.Pending;
      await params.scheduledNotifications.update(
        { id: scheduled.id },
        {
          status,
          attempt_count: attemptCount,
          last_error: error instanceof Error ? error.message : 'unknown error',
          locked_at: null,
        },
      );
      failed += 1;
    }
  }
  return { sent, failed };
}

export async function runProductExpiryAlertSweep(
  params: {
    inventoryProducts: Repository<InventoryProduct>;
    users: Repository<User>;
    ensurePreferences: (userId: string) => Promise<UserNotificationPreference>;
    dispatchWithPreferences: (
      params: DispatchNotificationParams,
      prefs: UserNotificationPreference,
      user?: User | null,
    ) => Promise<InAppNotification | null>;
  },
  now: Date,
): Promise<ProductExpiryAlertSweepResult> {
  let lastProductId: string | null = null;
  let processed = 0;
  let dispatched = 0;
  const maxCandidateExpiry = new Date(
    now.getTime() + (PRODUCT_EXPIRY_NOTICE_DAYS_MAX + 2) * DAY_MS,
  );

  while (true) {
    const products = await params.inventoryProducts.find({
      where: {
        status: ShelfStatus.Active,
        effective_expires_at: LessThanOrEqual(maxCandidateExpiry),
        ...(lastProductId ? { id: MoreThan(lastProductId) } : {}),
      },
      order: { id: 'ASC' },
      take: PRODUCT_EXPIRY_SWEEP_BATCH_SIZE,
    });
    if (products.length === 0) {
      return { processed, dispatched };
    }

    const usersById = await loadUsersById(
      params.users,
      products.map((product) => product.user_id),
    );
    const preferencesByUserId = new Map<string, UserNotificationPreference>();

    for (const product of products) {
      processed += 1;
      let prefs = preferencesByUserId.get(product.user_id);
      if (!prefs) {
        prefs = await params.ensurePreferences(product.user_id);
        preferencesByUserId.set(product.user_id, prefs);
      }

      const dispatchParams = buildProductExpiryDispatchParams({
        product,
        prefs,
        user: usersById.get(product.user_id) ?? null,
        now,
      });
      if (!dispatchParams) {
        continue;
      }

      const notification = await params.dispatchWithPreferences(
        dispatchParams,
        prefs,
        usersById.get(product.user_id) ?? null,
      );
      if (notification) {
        dispatched += 1;
      }
    }

    if (products.length < PRODUCT_EXPIRY_SWEEP_BATCH_SIZE) {
      return { processed, dispatched };
    }
    lastProductId = products[products.length - 1]?.id ?? lastProductId;
  }
}

export async function runReadNotificationRetentionSweep(
  params: {
    notifications: Repository<InAppNotification>;
  },
  now: Date,
): Promise<NotificationRetentionSweepResult> {
  const standardCutoff = subtractDays(now, NOTIFICATION_READ_RETENTION_DAYS);
  const safetyCutoff = subtractDays(
    now,
    NOTIFICATION_SAFETY_READ_RETENTION_DAYS,
  );

  const standard = await params.notifications.delete({
    kind: Not(In([...LONG_RETENTION_NOTIFICATION_KINDS])),
    read_at: LessThan(standardCutoff),
  });
  const safety = await params.notifications.delete({
    kind: In([...LONG_RETENTION_NOTIFICATION_KINDS]),
    read_at: LessThan(safetyCutoff),
  });

  return {
    deleted: (standard.affected ?? 0) + (safety.affected ?? 0),
  };
}

export function buildProductExpiryDispatchParams({
  product,
  prefs,
  user,
  now,
}: ProductExpiryDispatchInput): DispatchNotificationParams | null {
  if (product.status !== ShelfStatus.Active || !product.effective_expires_at) {
    return null;
  }

  const expiresDate = parseShelfPlainDate(product.effective_expires_at);
  if (!expiresDate) {
    return null;
  }

  const timeZone = resolveSkinJournalTimeZone(user?.time_zone ?? null);
  const today = resolveShelfToday(timeZone, now);
  const daysUntilExpiry = diffShelfCalendarDays(today, expiresDate);
  const noticeDays = normalizeProductExpiryNoticeDays(
    prefs.product_expiry_notice_days,
  );
  const kind =
    daysUntilExpiry <= 0
      ? 'product_expired'
      : daysUntilExpiry <= noticeDays
        ? 'product_nearing_expiry'
        : null;

  if (!kind) {
    return null;
  }

  const productName = [product.brand, product.name]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');

  return {
    userId: product.user_id,
    kind,
    titleKey: `notificationsPage.kinds.${kind}.title`,
    bodyKey: `notificationsPage.kinds.${kind}.body`,
    severity: kind === 'product_expired' ? 'critical' : 'warning',
    payload: {
      productId: product.id,
      brand: product.brand,
      name: product.name,
      productName: productName || product.name || product.brand,
      expiresAt: product.effective_expires_at.toISOString(),
      daysUntilExpiry,
      noticeDays,
    },
    deepLink: `/shelf/${product.id}`,
    dedupeKey: `${kind}:${product.id}:${expiresDate.toString()}`,
    bypassQuietHours: true,
    forcePush: true,
  };
}

export async function scheduleAfterQuietHours(
  params: DispatchNotificationParams,
  prefs: UserNotificationPreference,
  user: User | null,
  now: Date,
  scheduledNotifications: Repository<ScheduledNotification>,
): Promise<void> {
  const timeZone = resolveSkinJournalTimeZone(user?.time_zone ?? null);
  const deliverAt = nextQuietHoursEligibleInstant(
    now,
    timeZone,
    prefs.quiet_hours_start,
    prefs.quiet_hours_end,
  );
  const entity = scheduledNotifications.create({
    user_id: params.userId,
    kind: params.kind,
    title_key: params.titleKey,
    body_key: params.bodyKey,
    severity: params.severity ?? 'info',
    dedupe_key: params.dedupeKey ?? null,
    payload: params.payload ?? null,
    deep_link: params.deepLink ?? null,
    deliver_at: deliverAt,
    status: ScheduledNotificationStatusValue.Pending,
    attempt_count: 0,
    last_error: null,
    locked_at: null,
  });
  try {
    await scheduledNotifications.save(entity);
  } catch (error) {
    if (!params.dedupeKey || !isUniqueConstraintError(error)) {
      throw error;
    }
  }
}

export function applyPreferenceUpdates(
  prefs: UserNotificationPreference,
  dto: UpdatePreferencesDto,
): void {
  if (dto.photo_reminder_local_time !== undefined)
    prefs.photo_reminder_local_time = dto.photo_reminder_local_time;
  if (dto.photo_reminder_enabled !== undefined)
    prefs.photo_reminder_enabled = dto.photo_reminder_enabled;
  if (dto.channels !== undefined) prefs.channels = dto.channels;
  if (dto.reaction_alert_channels !== undefined)
    prefs.reaction_alert_channels = dto.reaction_alert_channels;
  if (dto.reaction_alerts_enabled !== undefined)
    prefs.reaction_alerts_enabled = dto.reaction_alerts_enabled;
  if (dto.simplification_alert_channels !== undefined)
    prefs.simplification_alert_channels = dto.simplification_alert_channels;
  if (dto.simplification_alerts_enabled !== undefined)
    prefs.simplification_alerts_enabled = dto.simplification_alerts_enabled;
  if (dto.insight_alert_channels !== undefined)
    prefs.insight_alert_channels = dto.insight_alert_channels;
  if (dto.insight_alerts_enabled !== undefined)
    prefs.insight_alerts_enabled = dto.insight_alerts_enabled;
  if (dto.insight_cadence !== undefined)
    prefs.insight_cadence = dto.insight_cadence;
  if (dto.insight_digest_day !== undefined)
    prefs.insight_digest_day = dto.insight_digest_day;
  if (dto.insight_digest_local_time !== undefined)
    prefs.insight_digest_local_time = dto.insight_digest_local_time;
  if (dto.wrapped_alert_channels !== undefined)
    prefs.wrapped_alert_channels = dto.wrapped_alert_channels;
  if (dto.wrapped_alerts_enabled !== undefined)
    prefs.wrapped_alerts_enabled = dto.wrapped_alerts_enabled;
  if (dto.photo_tutorial_completed !== undefined)
    prefs.photo_tutorial_completed = dto.photo_tutorial_completed;
  if (dto.suggestion_ready_channels !== undefined)
    prefs.suggestion_ready_channels = dto.suggestion_ready_channels;
  if (dto.suggestion_ready_enabled !== undefined)
    prefs.suggestion_ready_enabled = dto.suggestion_ready_enabled;
  if (dto.smart_pick_ready_channels !== undefined)
    prefs.smart_pick_ready_channels = dto.smart_pick_ready_channels;
  if (dto.smart_pick_ready_enabled !== undefined)
    prefs.smart_pick_ready_enabled = dto.smart_pick_ready_enabled;
  if (dto.slot_start_channels !== undefined)
    prefs.slot_start_channels = dto.slot_start_channels;
  if (dto.slot_start_enabled !== undefined)
    prefs.slot_start_enabled = dto.slot_start_enabled;
  if (dto.recording_reminder_channels !== undefined)
    prefs.recording_reminder_channels = dto.recording_reminder_channels;
  if (dto.recording_reminder_enabled !== undefined)
    prefs.recording_reminder_enabled = dto.recording_reminder_enabled;
  if (dto.product_expiry_alert_channels !== undefined)
    prefs.product_expiry_alert_channels = dto.product_expiry_alert_channels;
  if (dto.product_expiry_alerts_enabled !== undefined)
    prefs.product_expiry_alerts_enabled = dto.product_expiry_alerts_enabled;
  if (dto.product_expiry_notice_days !== undefined)
    prefs.product_expiry_notice_days = dto.product_expiry_notice_days;
  if (dto.suggestion_lead_time_minutes !== undefined)
    prefs.suggestion_lead_time_minutes = dto.suggestion_lead_time_minutes;
  if (dto.quiet_hours_enabled !== undefined)
    prefs.quiet_hours_enabled = dto.quiet_hours_enabled;
  if (dto.quiet_hours_start !== undefined)
    prefs.quiet_hours_start = dto.quiet_hours_start;
  if (dto.quiet_hours_end !== undefined)
    prefs.quiet_hours_end = dto.quiet_hours_end;
}

export function resolveNotificationChannels(
  prefs: UserNotificationPreference,
  kind: NotificationKind,
): NotificationChannel[] {
  return normalizeNotificationChannels(
    notificationSpecificChannels(prefs, kind),
    normalizeNotificationChannels(
      prefs.channels,
      DEFAULT_NOTIFICATION_CHANNELS,
    ),
  );
}

export function hasNotificationSpecificChannels(
  prefs: UserNotificationPreference,
  kind: NotificationKind,
): boolean {
  return notificationSpecificChannels(prefs, kind) != null;
}

async function maybeDispatchPhotoReminder(
  params: {
    entries: Repository<SkinJournalEntry>;
    notifications: Repository<InAppNotification>;
    dispatchWithPreferences: (
      params: DispatchNotificationParams,
      prefs: UserNotificationPreference,
      user?: User | null,
    ) => Promise<InAppNotification | null>;
  },
  pref: UserNotificationPreference,
  user: User | null,
  now: Date,
): Promise<void> {
  if (!user) {
    return;
  }
  const timeZone = resolveSkinJournalTimeZone(user.time_zone);
  if (!isReminderDue(now, timeZone, pref.photo_reminder_local_time)) {
    return;
  }
  const localDate = todayInTimeZone(timeZone, now);
  const existingEntryCount = await params.entries.count({
    where: { user_id: pref.user_id, entry_date: localDate },
  });
  if (existingEntryCount > 0) {
    return;
  }
  const localReminderWindow = localDayUtcRange(localDate, timeZone);
  const duplicateCount = await params.notifications.count({
    where: {
      user_id: pref.user_id,
      kind: 'photo_reminder',
      created_at: Between(localReminderWindow.start, localReminderWindow.end),
    },
  });
  if (duplicateCount > 0) {
    return;
  }
  await params.dispatchWithPreferences(
    {
      userId: pref.user_id,
      kind: 'photo_reminder',
      titleKey: 'skinJournal.notifications.photoReminder.title',
      bodyKey: 'skinJournal.notifications.photoReminder.body',
      payload: { entry_date: localDate },
      deepLink: '/journal/upload',
    },
    pref,
    user,
  );
}

async function loadUsersById(
  usersRepo: Repository<User>,
  userIds: string[],
): Promise<Map<string, User>> {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const users = await usersRepo.find({
    where: { id: In(uniqueIds) },
  });
  return new Map(users.map((user) => [user.id, user]));
}

export function isNotificationKindEnabled(
  prefs: UserNotificationPreference,
  kind: NotificationKind,
): boolean {
  if (kind === 'photo_reminder') return prefs.photo_reminder_enabled !== false;
  if (kind === 'reaction_detected')
    return prefs.reaction_alerts_enabled !== false;
  if (kind === 'simplification_started')
    return prefs.simplification_alerts_enabled !== false;
  if (kind === 'insight_ready' || kind === 'doctor_referral')
    return prefs.insight_alerts_enabled !== false;
  if (kind === 'wrapped_ready') return prefs.wrapped_alerts_enabled !== false;
  if (kind === 'suggestion_ready')
    return prefs.suggestion_ready_enabled !== false;
  if (kind === 'smart_pick_ready')
    return prefs.smart_pick_ready_enabled === true;
  if (kind === 'slot_start') return prefs.slot_start_enabled !== false;
  if (kind === 'recording_reminder')
    return prefs.recording_reminder_enabled !== false;
  if (kind === 'product_nearing_expiry' || kind === 'product_expired') {
    return prefs.product_expiry_alerts_enabled !== false;
  }
  return true;
}

export function canSendNotificationEmail(kind: NotificationKind): boolean {
  return kind in NOTIFICATION_KIND_TEMPLATE;
}

export function requiresNotificationInApp(kind: NotificationKind): boolean {
  return kind === 'product_nearing_expiry' || kind === 'product_expired';
}

export function requiresNotificationPush(kind: NotificationKind): boolean {
  return kind === 'product_nearing_expiry' || kind === 'product_expired';
}

export function normalizeProductExpiryNoticeDays(
  value: number | null | undefined,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return PRODUCT_EXPIRY_NOTICE_DAYS_DEFAULT;
  }
  return Math.max(
    PRODUCT_EXPIRY_NOTICE_DAYS_MIN,
    Math.min(PRODUCT_EXPIRY_NOTICE_DAYS_MAX, value),
  );
}

export function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function subtractDays(value: Date, days: number): Date {
  return new Date(value.getTime() - days * DAY_MS);
}

function notificationSpecificChannels(
  prefs: UserNotificationPreference,
  kind: NotificationKind,
): NotificationChannel[] | null {
  if (kind === 'photo_reminder') return prefs.channels;
  if (kind === 'reaction_detected') return prefs.reaction_alert_channels;
  if (kind === 'simplification_started')
    return prefs.simplification_alert_channels;
  if (kind === 'insight_ready' || kind === 'doctor_referral')
    return prefs.insight_alert_channels;
  if (kind === 'wrapped_ready') return prefs.wrapped_alert_channels;
  if (kind === 'suggestion_ready') return prefs.suggestion_ready_channels;
  if (kind === 'smart_pick_ready') return prefs.smart_pick_ready_channels;
  if (kind === 'slot_start') return prefs.slot_start_channels;
  if (kind === 'recording_reminder') return prefs.recording_reminder_channels;
  if (kind === 'product_nearing_expiry' || kind === 'product_expired') {
    return prefs.product_expiry_alert_channels;
  }
  return null;
}

function normalizeNotificationChannels(
  value: NotificationChannel[] | null | undefined,
  fallback: NotificationChannel[],
): NotificationChannel[] {
  const source = Array.isArray(value) ? value : fallback;
  const allowed = new Set<NotificationChannel>(NOTIFICATION_CHANNEL_VALUES);
  const seen = new Set<NotificationChannel>();
  return source.filter((channel) => {
    if (!allowed.has(channel) || seen.has(channel)) return false;
    seen.add(channel);
    return true;
  });
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
