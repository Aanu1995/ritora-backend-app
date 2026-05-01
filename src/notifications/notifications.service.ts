import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  Brackets,
  In,
  IsNull,
  MoreThan,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { MailService } from '../mail/mail.service';
import {
  decodeCursor,
  encodeCursor,
  type PaginatedResult,
} from '../common/utils/cursor-pagination';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SKIN_JOURNAL_REMINDER_DEFAULT_TIME } from '../skin-journal/skin-journal.constants';
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
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import { NotificationResponseDto } from './dto/notification-response.dto';
import {
  PreferencesResponseDto,
  UpdatePreferencesDto,
} from './dto/notification-preference.dto';
import {
  NOTIFICATION_PAGE_DEFAULT_LIMIT,
  NOTIFICATION_PAGE_MAX_LIMIT,
} from './notifications.constants';

export type NotificationsListResponse =
  PaginatedResult<NotificationResponseDto> & {
    unread_count: number;
  };

type NotificationCursorTuple = [number, string, string];

const NOTIFICATION_CURSOR_FINGERPRINT_PREFIX = 'notifications:v1';
const NOTIFICATION_READ_BUCKET_SQL =
  'CASE WHEN notification.read_at IS NULL THEN 0 ELSE 1 END';
const PHOTO_REMINDER_SWEEP_BATCH_SIZE = 1000;

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private reminderTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(InAppNotification)
    private readonly notifications: Repository<InAppNotification>,
    @InjectRepository(UserNotificationPreference)
    private readonly preferences: Repository<UserNotificationPreference>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(SkinJournalEntry)
    private readonly entries: Repository<SkinJournalEntry>,
    private readonly mailService: MailService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.reminderTimer = setInterval(
      () => {
        void this.runPhotoReminderSweep(new Date()).catch((error) => {
          this.logger.warn(
            `Photo reminder sweep failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        });
      },
      15 * 60 * 1000,
    );
    this.reminderTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.reminderTimer) {
      clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
  }

  async list(
    userId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<NotificationsListResponse> {
    const take = clampInteger(
      options.limit ?? NOTIFICATION_PAGE_DEFAULT_LIMIT,
      1,
      NOTIFICATION_PAGE_MAX_LIMIT,
    );
    const unreadWhere = { user_id: userId, read_at: IsNull() };
    const fingerprint = notificationCursorFingerprint(userId);
    const queryBuilder = this.notifications
      .createQueryBuilder('notification')
      .where('notification.user_id = :userId', { userId })
      .orderBy(NOTIFICATION_READ_BUCKET_SQL, 'ASC')
      .addOrderBy('notification.created_at', 'DESC')
      .addOrderBy('notification.id', 'DESC');
    applyNotificationCursor(queryBuilder, options.cursor, fingerprint);

    const [entities, unreadCount] = await Promise.all([
      queryBuilder.take(take + 1).getMany(),
      this.notifications.count({ where: unreadWhere }),
    ]);
    const hasMore = entities.length > take;
    const pageEntities = hasMore ? entities.slice(0, take) : entities;
    const nextCursor = buildNotificationNextCursor(
      pageEntities.at(-1),
      fingerprint,
      hasMore,
    );

    return {
      items: pageEntities.map((n) => NotificationResponseDto.fromEntity(n)),
      nextCursor,
      unread_count: unreadCount,
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const notif = await this.notifications.findOne({
      where: { id, user_id: userId },
    });
    if (!notif) throw new NotFoundException('Notification not found');
    if (!notif.read_at) {
      notif.read_at = new Date();
      await this.notifications.save(notif);
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifications.update(
      { user_id: userId, read_at: IsNull() },
      { read_at: new Date() },
    );
  }

  async getPreferences(userId: string): Promise<PreferencesResponseDto> {
    const prefs = await this.ensurePreferences(userId);
    return PreferencesResponseDto.fromEntity(prefs);
  }

  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<PreferencesResponseDto> {
    const prefs = await this.ensurePreferences(userId);
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
    const saved = await this.preferences.save(prefs);
    return PreferencesResponseDto.fromEntity(saved);
  }

  async dispatch(params: {
    userId: string;
    kind: NotificationKind;
    titleKey: string;
    bodyKey: string;
    severity?: NotificationSeverity;
    payload?: Record<string, unknown>;
    deepLink?: string;
  }): Promise<InAppNotification | null> {
    const prefs = await this.ensurePreferences(params.userId);
    return this.dispatchWithPreferences(params, prefs);
  }

  private async dispatchWithPreferences(
    params: {
      userId: string;
      kind: NotificationKind;
      titleKey: string;
      bodyKey: string;
      severity?: NotificationSeverity;
      payload?: Record<string, unknown>;
      deepLink?: string;
    },
    prefs: UserNotificationPreference,
    user?: User | null,
  ): Promise<InAppNotification | null> {
    if (!isNotificationKindEnabled(prefs, params.kind)) {
      return null;
    }

    let saved: InAppNotification | null = null;
    if (prefs.channels.includes('in_app')) {
      saved = await this.notifications.save(
        this.notifications.create({
          user_id: params.userId,
          kind: params.kind,
          title_key: params.titleKey,
          body_key: params.bodyKey,
          severity: params.severity ?? 'info',
          payload: params.payload ?? null,
          deep_link: params.deepLink ?? null,
        }),
      );
    }

    if (prefs.channels.includes('email')) {
      await this.dispatchEmail(params, user);
    }

    return saved;
  }

  async runPhotoReminderSweep(now: Date = new Date()): Promise<void> {
    let lastUserId: string | null = null;
    while (true) {
      const prefs = await this.preferences.find({
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
      const usersById = await this.loadUsersById(
        prefs.map((pref) => pref.user_id),
      );
      for (const pref of prefs) {
        await this.maybeDispatchPhotoReminder(
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

  private async maybeDispatchPhotoReminder(
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
    const localDate = todayInTimeZone(timeZone);
    const existingEntryCount = await this.entries.count({
      where: { user_id: pref.user_id, entry_date: localDate },
    });
    if (existingEntryCount > 0) {
      return;
    }
    const duplicateCount = await this.notifications.count({
      where: {
        user_id: pref.user_id,
        kind: 'photo_reminder',
        created_at: Between(startOfUtcDay(now), endOfUtcDay(now)),
      },
    });
    if (duplicateCount > 0) {
      return;
    }
    await this.dispatchWithPreferences(
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

  private async loadUsersById(userIds: string[]): Promise<Map<string, User>> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const users = await this.users.find({
      where: { id: In(uniqueIds) },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  private async ensurePreferences(
    userId: string,
  ): Promise<UserNotificationPreference> {
    let prefs = await this.preferences.findOne({
      where: { user_id: userId },
    });
    if (!prefs) {
      prefs = this.preferences.create({
        user_id: userId,
        channels: ['in_app', 'email'],
        photo_reminder_enabled: true,
        photo_reminder_local_time: SKIN_JOURNAL_REMINDER_DEFAULT_TIME,
        reaction_alerts_enabled: true,
        simplification_alerts_enabled: true,
        insight_alerts_enabled: true,
        ai_polished_insights_enabled: true,
        wrapped_alerts_enabled: true,
        photo_tutorial_completed: false,
      });
      try {
        prefs = await this.preferences.save(prefs);
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
        const racedPrefs = await this.preferences.findOne({
          where: { user_id: userId },
        });
        if (!racedPrefs) {
          throw error;
        }
        return racedPrefs;
      }
    }
    return prefs;
  }

  private async dispatchEmail(
    params: {
      userId: string;
      kind: NotificationKind;
      titleKey: string;
      bodyKey: string;
      severity?: NotificationSeverity;
      payload?: Record<string, unknown>;
      deepLink?: string;
    },
    prefetchedUser?: User | null,
  ): Promise<void> {
    const user =
      prefetchedUser ??
      (await this.users.findOne({ where: { id: params.userId } }));
    if (!user?.email) {
      return;
    }
    try {
      await this.mailService.sendNotificationEmail(
        user.email,
        params.titleKey,
        params.bodyKey,
      );
    } catch (error) {
      this.logger.warn(
        `Notification email failed for ${params.kind}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}

function isNotificationKindEnabled(
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
  return true;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isReminderDue(
  now: Date,
  timeZone: string,
  reminderTime: string,
): boolean {
  const reminderMinutes = parseClockMinutes(reminderTime);
  const localMinutes = minutesInTimeZone(now, timeZone);
  const delta = localMinutes - reminderMinutes;
  return delta >= 0 && delta < 15;
}

function parseClockMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function minutesInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? 0,
  );
  return hour * 60 + minute;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function endOfUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + 24 * 60 * 60 * 1000 - 1);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function notificationCursorFingerprint(userId: string): string {
  return `${NOTIFICATION_CURSOR_FINGERPRINT_PREFIX}:${userId}`;
}

function applyNotificationCursor(
  queryBuilder: SelectQueryBuilder<InAppNotification>,
  cursor: string | undefined,
  fingerprint: string,
): void {
  if (!cursor) {
    return;
  }

  const decoded = decodeCursor(cursor);
  if (decoded.fingerprint !== fingerprint) {
    throw new BadRequestException('Cursor does not match this request');
  }

  const [bucket, createdAt, id] = decoded.tuple;
  if (
    (bucket !== 0 && bucket !== 1) ||
    typeof createdAt !== 'string' ||
    typeof id !== 'string'
  ) {
    throw new BadRequestException('Invalid cursor');
  }

  queryBuilder.andWhere(
    new Brackets((qb) => {
      qb.where(`${NOTIFICATION_READ_BUCKET_SQL} > :cursorBucket`, {
        cursorBucket: bucket,
      })
        .orWhere(
          `${NOTIFICATION_READ_BUCKET_SQL} = :cursorBucket AND notification.created_at < :cursorCreatedAt`,
          { cursorBucket: bucket, cursorCreatedAt: createdAt },
        )
        .orWhere(
          `${NOTIFICATION_READ_BUCKET_SQL} = :cursorBucket AND notification.created_at = :cursorCreatedAt AND notification.id < :cursorId`,
          { cursorBucket: bucket, cursorCreatedAt: createdAt, cursorId: id },
        );
    }),
  );
}

function buildNotificationNextCursor(
  item: InAppNotification | undefined,
  fingerprint: string,
  hasMore: boolean,
): string | null {
  if (!hasMore || !item) {
    return null;
  }

  return encodeCursor({
    fingerprint,
    tuple: notificationCursorTuple(item),
  });
}

function notificationCursorTuple(
  item: InAppNotification,
): NotificationCursorTuple {
  return [item.read_at ? 1 : 0, toCursorDate(item.created_at), item.id];
}

function toCursorDate(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
