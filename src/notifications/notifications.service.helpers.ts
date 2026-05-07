import { Between, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import {
  resolveSkinJournalTimeZone,
  todayInTimeZone,
} from '../skin-journal/skin-journal.utils';
import { User } from '../users/entities/user.entity';
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
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
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
};

const PHOTO_REMINDER_SWEEP_BATCH_SIZE = 1000;
const SCHEDULED_NOTIFICATION_BATCH_SIZE = 100;
const SCHEDULED_NOTIFICATION_MAX_ATTEMPTS = 3;

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
  if (dto.reaction_alerts_enabled !== undefined)
    prefs.reaction_alerts_enabled = dto.reaction_alerts_enabled;
  if (dto.simplification_alerts_enabled !== undefined)
    prefs.simplification_alerts_enabled = dto.simplification_alerts_enabled;
  if (dto.insight_alerts_enabled !== undefined)
    prefs.insight_alerts_enabled = dto.insight_alerts_enabled;
  if (dto.ai_polished_insights_enabled !== undefined)
    prefs.ai_polished_insights_enabled = dto.ai_polished_insights_enabled;
  if (dto.wrapped_alerts_enabled !== undefined)
    prefs.wrapped_alerts_enabled = dto.wrapped_alerts_enabled;
  if (dto.photo_tutorial_completed !== undefined)
    prefs.photo_tutorial_completed = dto.photo_tutorial_completed;
  if (dto.suggestion_ready_enabled !== undefined)
    prefs.suggestion_ready_enabled = dto.suggestion_ready_enabled;
  if (dto.slot_start_enabled !== undefined)
    prefs.slot_start_enabled = dto.slot_start_enabled;
  if (dto.recording_reminder_enabled !== undefined)
    prefs.recording_reminder_enabled = dto.recording_reminder_enabled;
  if (dto.suggestion_lead_time_minutes !== undefined)
    prefs.suggestion_lead_time_minutes = dto.suggestion_lead_time_minutes;
  if (dto.quiet_hours_enabled !== undefined)
    prefs.quiet_hours_enabled = dto.quiet_hours_enabled;
  if (dto.quiet_hours_start !== undefined)
    prefs.quiet_hours_start = dto.quiet_hours_start;
  if (dto.quiet_hours_end !== undefined)
    prefs.quiet_hours_end = dto.quiet_hours_end;
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
  if (kind === 'slot_start') return prefs.slot_start_enabled !== false;
  if (kind === 'recording_reminder')
    return prefs.recording_reminder_enabled !== false;
  return true;
}

export function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
