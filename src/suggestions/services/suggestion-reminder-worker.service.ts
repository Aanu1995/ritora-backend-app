import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { User } from '../../users/entities/user.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  RECORDING_REMINDER_DELAY_MINUTES,
  SUGGESTION_GENERATION_POLL_INTERVAL_MS,
} from '../suggestions.constants';
import { buildSlotInstant } from './suggestion-helpers';

/**
 * Sends the two reminder notifications anchored to each suggestion:
 *
 *  - `slot_start`: dispatched at the scheduled slot time so the user
 *    remembers to apply.
 *  - `recording_reminder`: dispatched 30 minutes after the slot if the
 *    user has not yet recorded an application log.
 *
 * Both honour the user's quiet hours through `NotificationsService`,
 * which delays non-urgent messages into the persisted retry queue.
 * Dedupe keys make each notification idempotent per (suggestion, kind).
 */
@Injectable()
export class SuggestionReminderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SuggestionReminderWorker.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(ApplicationLog)
    private readonly applicationLogRepo: Repository<ApplicationLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    this.enabled = this.configService.get<string>('NODE_ENV') !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'Suggestion reminder worker disabled in test environment.',
      );
      return;
    }
    this.stopped = false;
    this.scheduleNext(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Public for tests. Runs one scan, dispatching the appropriate
   * reminders for every suggestion that has reached its slot start or
   * recording-reminder window.
   */
  async runOnce(): Promise<{ slotStart: number; recordingReminder: number }> {
    const now = new Date();
    let slotStart = 0;
    let recordingReminder = 0;

    const { fromDate, toDate } = reminderTargetDateWindow(now);

    // Find only ready suggestions near the current local-day windows. Without
    // this bound, every old suggestion stays in the worker scan forever.
    const readySuggestions = await this.suggestionRepo.find({
      where: {
        generation_status: 'ready',
        target_date: Between(fromDate, toDate),
      },
    });

    if (readySuggestions.length === 0) {
      return { slotStart: 0, recordingReminder: 0 };
    }

    const userIds = Array.from(new Set(readySuggestions.map((s) => s.user_id)));
    const users = await this.userRepo.find({
      where: { id: In(userIds) },
    });
    const usersById = new Map(users.map((u) => [u.id, u]));

    const suggestionIds = readySuggestions.map((s) => s.id);
    const logs = await this.applicationLogRepo.find({
      where: {
        suggestion_instance_id: In(suggestionIds),
      },
    });
    const loggedSuggestionIds = new Set(
      logs.map((log) => log.suggestion_instance_id).filter(Boolean) as string[],
    );

    for (const suggestion of readySuggestions) {
      const user = usersById.get(suggestion.user_id);
      if (!user) continue;
      const timeZone = resolveEffectiveTimeZone(user.time_zone, null);
      const slotInstant = buildSlotInstant(
        suggestion.target_date,
        suggestion.target_time,
        timeZone,
      );

      // slot_start window: the minute the slot opens.
      if (isDueBeforeEndOfNextDay(now, slotInstant)) {
        const dispatched = await this.notifications.dispatch({
          userId: user.id,
          kind: 'slot_start',
          titleKey: 'notificationsPage.kinds.slot_start.title',
          bodyKey: 'notificationsPage.kinds.slot_start.body',
          deepLink: '/todays-suggestion',
          payload: {
            suggestionId: suggestion.id,
            slotId: suggestion.slot_id,
          },
          dedupeKey: `slot_start:${suggestion.id}`,
        });
        if (dispatched) slotStart += 1;
      }

      // recording_reminder window: 30 min after slot start if no record yet.
      const reminderInstant = new Date(
        slotInstant.getTime() + RECORDING_REMINDER_DELAY_MINUTES * 60_000,
      );
      if (
        isDueBeforeEndOfNextDay(now, reminderInstant) &&
        !loggedSuggestionIds.has(suggestion.id)
      ) {
        const dispatched = await this.notifications.dispatch({
          userId: user.id,
          kind: 'recording_reminder',
          titleKey: 'notificationsPage.kinds.recording_reminder.title',
          bodyKey: 'notificationsPage.kinds.recording_reminder.body',
          deepLink: '/todays-suggestion',
          payload: {
            suggestionId: suggestion.id,
            slotId: suggestion.slot_id,
          },
          dedupeKey: `recording_reminder:${suggestion.id}`,
        });
        if (dispatched) recordingReminder += 1;
      }
    }

    return { slotStart, recordingReminder };
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((error) => {
          this.logger.error(
            'Suggestion reminder worker failed',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => {
          if (!this.stopped) {
            this.scheduleNext(SUGGESTION_GENERATION_POLL_INTERVAL_MS);
          }
        });
    }, delayMs);
    this.timer.unref?.();
  }
}

function isDueBeforeEndOfNextDay(now: Date, target: Date): boolean {
  const diff = now.getTime() - target.getTime();
  return diff >= 0 && diff <= 36 * 60 * 60 * 1000;
}

function reminderTargetDateWindow(now: Date): {
  fromDate: string;
  toDate: string;
} {
  const current = now.toISOString().slice(0, 10);
  return {
    fromDate: shiftUtcDate(current, -2),
    toDate: shiftUtcDate(current, 1),
  };
}

function shiftUtcDate(date: string, days: number): string {
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}
