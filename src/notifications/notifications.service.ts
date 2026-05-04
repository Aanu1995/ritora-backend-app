import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { type PaginatedResult } from '../common/utils/cursor-pagination';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SKIN_JOURNAL_REMINDER_DEFAULT_TIME } from '../skin-journal/skin-journal.constants';
import { User } from '../users/entities/user.entity';
import { InAppNotification } from './entities/in-app-notification.entity';
import { ScheduledNotification } from './entities/scheduled-notification.entity';
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
import {
  applyNotificationCursor,
  applyPreferenceUpdates,
  buildNotificationNextCursor,
  clampInteger,
  DispatchNotificationParams,
  isDelayedByQuietHours,
  isNotificationKindEnabled,
  isUniqueConstraintError,
  notificationCursorFingerprint,
  NOTIFICATION_READ_BUCKET_SQL,
  runPhotoReminderSweep,
  runScheduledNotificationSweep,
  scheduleAfterQuietHours,
} from './notifications.service.helpers';

export type NotificationsListResponse =
  PaginatedResult<NotificationResponseDto> & {
    unread_count: number;
  };

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private reminderTimer: NodeJS.Timeout | null = null;
  private scheduledTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(InAppNotification)
    private readonly notifications: Repository<InAppNotification>,
    @InjectRepository(ScheduledNotification)
    private readonly scheduledNotifications: Repository<ScheduledNotification>,
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
    this.scheduledTimer = setInterval(
      () => {
        void this.runScheduledNotificationSweep(new Date()).catch((error) => {
          this.logger.warn(
            `Scheduled notification sweep failed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        });
      },
      5 * 60 * 1000,
    );
    this.scheduledTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.reminderTimer) {
      clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
    if (this.scheduledTimer) {
      clearInterval(this.scheduledTimer);
      this.scheduledTimer = null;
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
    applyPreferenceUpdates(prefs, dto);
    const saved = await this.preferences.save(prefs);
    return PreferencesResponseDto.fromEntity(saved);
  }

  async dispatch(
    params: DispatchNotificationParams,
  ): Promise<InAppNotification | null> {
    const prefs = await this.ensurePreferences(params.userId);
    return this.dispatchWithPreferences(params, prefs);
  }

  private async dispatchWithPreferences(
    params: DispatchNotificationParams,
    prefs: UserNotificationPreference,
    user?: User | null,
  ): Promise<InAppNotification | null> {
    if (!isNotificationKindEnabled(prefs, params.kind)) {
      return null;
    }

    const notificationUser = await this.resolveNotificationUser(
      params,
      prefs,
      user,
    );
    const now = new Date();
    if (
      !params.bypassQuietHours &&
      isDelayedByQuietHours(prefs, params.kind, notificationUser, now)
    ) {
      await scheduleAfterQuietHours(
        params,
        prefs,
        notificationUser,
        now,
        this.scheduledNotifications,
      );
      return null;
    }

    const duplicate = params.dedupeKey
      ? await this.findDuplicateNotification(params)
      : null;
    if (duplicate) {
      return duplicate;
    }

    let saved: InAppNotification | null = null;
    if (prefs.channels.includes('in_app')) {
      saved = await this.createInAppNotification(params);
    }

    if (prefs.channels.includes('email')) {
      await this.dispatchEmail(params, notificationUser);
    }

    return saved;
  }

  async runPhotoReminderSweep(now: Date = new Date()): Promise<void> {
    return runPhotoReminderSweep(
      {
        preferences: this.preferences,
        users: this.users,
        entries: this.entries,
        notifications: this.notifications,
        dispatchWithPreferences: (params, prefs, user) =>
          this.dispatchWithPreferences(params, prefs, user),
      },
      now,
    );
  }

  async runScheduledNotificationSweep(now: Date = new Date()): Promise<{
    sent: number;
    failed: number;
  }> {
    return runScheduledNotificationSweep(
      {
        scheduledNotifications: this.scheduledNotifications,
        dispatch: (params) => this.dispatch(params),
      },
      now,
    );
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
        suggestion_ready_enabled: true,
        slot_start_enabled: true,
        recording_reminder_enabled: true,
        suggestion_lead_time_minutes: 120,
        quiet_hours_enabled: false,
        quiet_hours_start: '22:30',
        quiet_hours_end: '06:30',
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
    params: DispatchNotificationParams,
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

  private async resolveNotificationUser(
    params: DispatchNotificationParams,
    prefs: UserNotificationPreference,
    prefetchedUser?: User | null,
  ): Promise<User | null> {
    if (prefetchedUser) return prefetchedUser;
    if (!prefs.quiet_hours_enabled && !prefs.channels.includes('email')) {
      return null;
    }
    return this.users.findOne({ where: { id: params.userId } });
  }

  private async createInAppNotification(
    params: DispatchNotificationParams,
  ): Promise<InAppNotification | null> {
    try {
      return await this.notifications.save(
        this.notifications.create({
          user_id: params.userId,
          kind: params.kind,
          title_key: params.titleKey,
          body_key: params.bodyKey,
          severity: params.severity ?? 'info',
          dedupe_key: params.dedupeKey ?? null,
          payload: params.payload ?? null,
          deep_link: params.deepLink ?? null,
        }),
      );
    } catch (error) {
      if (!params.dedupeKey || !isUniqueConstraintError(error)) {
        throw error;
      }
      return this.findDuplicateNotification(params);
    }
  }

  private findDuplicateNotification(
    params: DispatchNotificationParams,
  ): Promise<InAppNotification | null> {
    if (!params.dedupeKey) {
      return Promise.resolve(null);
    }
    return this.notifications.findOne({
      where: {
        user_id: params.userId,
        kind: params.kind,
        dedupe_key: params.dedupeKey,
      },
    });
  }
}
