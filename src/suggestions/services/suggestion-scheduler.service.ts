import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindManyOptions,
  In,
  IsNull,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { SlotModeValue } from '../../schedule/dto/schedule.constants';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SUGGESTION_SCHEDULER_BATCH_SIZE,
  SUGGESTION_SCHEDULER_INTERVAL_MS,
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
  SuggestionMode,
  SuggestionRequestSource,
} from '../suggestions.constants';
import { RoutineBreakService } from './routine-break.service';
import {
  buildSlotInstant,
  clampLeadTimeMinutes,
  deriveSuggestionDaypart,
  formatDateInTimeZone,
} from './suggestion-helpers';
import { insertSuggestionGenerationJob } from './suggestion-generation-job-queue';

const SCHEDULER_DAYS_OF_WEEK = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const;

type EligibleScheduleCandidate = {
  slot: ScheduleSlot;
  user: User;
  targetDate: string;
  visibleAt: Date;
};

/**
 * Scans every active user's schedule and inserts a generation job only
 * when the slot's visibility window has opened. Idempotent thanks to the
 * `UQ_suggestion_jobs_user_slot_date` unique index, so running on
 * multiple instances will not double-enqueue.
 */
@Injectable()
export class SuggestionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SuggestionScheduler.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(SuggestionGenerationJob)
    private readonly jobRepo: Repository<SuggestionGenerationJob>,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserNotificationPreference)
    private readonly preferenceRepo: Repository<UserNotificationPreference>,
    private readonly routineBreakService: RoutineBreakService,
  ) {
    this.enabled = this.configService.get<string>('NODE_ENV') !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Suggestion scheduler disabled in test environment.');
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
   * Public for tests + manual triggering. Walks each user's slots and
   * enqueues missing generation jobs.
   */
  async runOnce(): Promise<{ enqueued: number }> {
    let enqueued = 0;
    const now = new Date();
    let lastSeenId: string | null = null;

    while (true) {
      const slots = await this.loadSlotBatch(lastSeenId);
      if (slots.length === 0) break;
      lastSeenId = slots[slots.length - 1]?.id ?? lastSeenId;
      enqueued += await this.processSlotBatch(slots, now);
      if (slots.length < SUGGESTION_SCHEDULER_BATCH_SIZE) break;
    }

    return { enqueued };
  }

  private async processSlotBatch(
    slots: ScheduleSlot[],
    now: Date,
  ): Promise<number> {
    let enqueued = 0;
    const userIds = Array.from(new Set(slots.map((slot) => slot.user_id)));
    const users = await this.userRepo.find({
      where: { id: In(userIds), email_verified: true },
    });
    const usersById = new Map(users.map((user) => [user.id, user]));
    const activeBreakUserIds = await this.routineBreakService.getActiveUserIds(
      userIds,
      now,
    );
    const prefs = await this.preferenceRepo.find({
      where: { user_id: In(userIds) },
    });
    const prefsById = new Map(prefs.map((pref) => [pref.user_id, pref]));
    const candidates: EligibleScheduleCandidate[] = [];

    for (const slot of slots) {
      if (activeBreakUserIds.has(slot.user_id)) continue;
      const user = usersById.get(slot.user_id);
      if (!user) continue;
      const pref = prefsById.get(slot.user_id);
      const leadMinutes = clampLeadTimeMinutes(
        pref?.suggestion_lead_time_minutes ?? 120,
      );
      const timeZone = resolveEffectiveTimeZone(user.time_zone, null);

      // Look at today and tomorrow in the user's TZ.
      const candidateDates = [
        formatDateInTimeZone(timeZone, now),
        formatDateInTimeZone(timeZone, new Date(now.getTime() + 86_400_000)),
      ];
      for (const targetDate of candidateDates) {
        if (!matchesDayOfWeek(targetDate, slot.day_of_week)) continue;
        const slotInstant = buildSlotInstant(
          targetDate,
          slot.slot_time,
          timeZone,
        );
        const visibleAt = new Date(
          slotInstant.getTime() - leadMinutes * 60_000,
        );
        if (visibleAt.getTime() > now.getTime()) continue;
        // Suggestions are shown before a slot starts. If the slot time has
        // passed, keep History suggestion-only instead of backfilling a missed
        // routine after a break, outage, or delayed scheduler run.
        if (slotInstant.getTime() <= now.getTime()) continue;

        candidates.push({ slot, user, targetDate, visibleAt });
      }
    }

    if (candidates.length === 0) return 0;
    await this.ensurePendingSuggestions(candidates);

    for (const candidate of candidates) {
      const { slot, user, targetDate, visibleAt } = candidate;
      try {
        const inserted = await insertSuggestionGenerationJob(this.jobRepo, {
          user_id: user.id,
          slot_id: slot.id,
          target_date: targetDate,
          target_time: slot.slot_time,
          visible_at: visibleAt,
          status: SuggestionGenerationJobStatus.Queued,
          attempt_count: 0,
          run_after: visibleAt,
          last_error: null,
        });
        if (inserted) enqueued += 1;
      } catch (error) {
        this.logger.warn(
          `Failed to enqueue job for user ${user.id}, slot ${slot.id}, date ${targetDate}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    return enqueued;
  }

  private async loadSlotBatch(
    lastSeenId: string | null,
  ): Promise<ScheduleSlot[]> {
    const options: FindManyOptions<ScheduleSlot> = {
      where: { deleted_at: IsNull() },
      order: { id: 'ASC' },
      take: SUGGESTION_SCHEDULER_BATCH_SIZE,
    };
    if (lastSeenId) {
      options.where = { id: MoreThan(lastSeenId), deleted_at: IsNull() };
    }
    return this.slotRepo.find(options);
  }

  private async ensurePendingSuggestions(
    candidates: readonly EligibleScheduleCandidate[],
  ): Promise<void> {
    const existing = await this.suggestionRepo.find({
      where: {
        user_id: In(uniqueValues(candidates.map(({ user }) => user.id))),
        slot_id: In(uniqueValues(candidates.map(({ slot }) => slot.id))),
        target_date: In(
          uniqueValues(candidates.map(({ targetDate }) => targetDate)),
        ),
        generation_status: Not(SuggestionGenerationStatus.Superseded),
      },
      select: ['id', 'user_id', 'slot_id', 'target_date'],
    });
    const existingKeys = new Set(
      existing.map((suggestion) =>
        scheduleCandidateKey(
          suggestion.user_id,
          suggestion.slot_id ?? '',
          suggestion.target_date,
        ),
      ),
    );
    const pending = candidates
      .filter(
        ({ slot, user, targetDate }) =>
          !existingKeys.has(scheduleCandidateKey(user.id, slot.id, targetDate)),
      )
      .map(({ slot, user, targetDate, visibleAt }) =>
        this.suggestionRepo.create({
          user_id: user.id,
          slot_id: slot.id,
          request_source: SuggestionRequestSource.Scheduled,
          request_id: null,
          request_context: null,
          target_date: targetDate,
          target_time: slot.slot_time,
          daypart: deriveSuggestionDaypart(slot.slot_time),
          mode:
            slot.mode === SlotModeValue.Manual
              ? SuggestionMode.Manual
              : SuggestionMode.Ai,
          generation_status: SuggestionGenerationStatus.Pending,
          visible_at: visibleAt,
          generated_at: null,
          ai_model: null,
          ai_prompt_version: null,
          ai_input_tokens: null,
          ai_output_tokens: null,
          ai_total_tokens: null,
          ai_estimated_cost_usd: null,
          ai_duration_ms: null,
          ai_explanation: null,
          generation_context: null,
          gap_recommendations: null,
          safety_flags: null,
          has_reaction_signal: false,
          simplified_for_reaction: false,
          supersedes_id: null,
          ai_error: null,
          ai_retry_count: 0,
        }),
      );

    if (pending.length > 0) {
      await this.suggestionRepo.save(pending);
    }
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
            'Suggestion scheduler run failed',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => {
          if (!this.stopped) {
            this.scheduleNext(SUGGESTION_SCHEDULER_INTERVAL_MS);
          }
        });
    }, delayMs);
    this.timer.unref?.();
  }
}

function scheduleCandidateKey(
  userId: string,
  slotId: string,
  targetDate: string,
): string {
  return `${userId}:${slotId}:${targetDate}`;
}

function uniqueValues(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function matchesDayOfWeek(targetDate: string, dayOfWeek: string): boolean {
  const date = new Date(`${targetDate}T00:00:00Z`);
  const slotDay = SCHEDULER_DAYS_OF_WEEK[date.getUTCDay()];
  return slotDay === dayOfWeek;
}
