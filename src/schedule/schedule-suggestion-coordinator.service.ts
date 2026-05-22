import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { UserNotificationPreference } from '../notifications/entities/user-notification-preference.entity';
import { SuggestionGenerationJob } from '../suggestions/entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import {
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
  SuggestionMode,
  SuggestionRequestSource,
} from '../suggestions/suggestions.constants';
import { requeueSuggestionGenerationJob } from '../suggestions/services/suggestion-generation-job-queue';
import {
  buildSlotInstant,
  clampLeadTimeMinutes,
  deriveSuggestionDaypart,
  formatDateInTimeZone,
} from '../suggestions/services/suggestion-helpers';
import { User } from '../users/entities/user.entity';
import { DayOfWeek, SlotModeValue } from './dto/schedule.constants';
import { ScheduleSlot } from './entities/schedule-slot.entity';

const DATE_DAY_LOOKUP: Record<number, DayOfWeek> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};

type ScheduleChangeContext = {
  now: Date;
  dates: string[];
  timeZone: string;
  leadMinutes: number;
};

@Injectable()
export class ScheduleSuggestionCoordinator {
  constructor(
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(SuggestionGenerationJob)
    private readonly jobRepo: Repository<SuggestionGenerationJob>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserNotificationPreference)
    private readonly preferenceRepo: Repository<UserNotificationPreference>,
    @InjectRepository(ApplicationLog)
    private readonly applicationLogRepo: Repository<ApplicationLog>,
  ) {}

  async handleSlotChanged(userId: string, slot: ScheduleSlot): Promise<void> {
    const context = await this.buildContext(userId);
    const stale = await this.findEditableSuggestions(
      userId,
      slot,
      context.dates,
    );
    const recordedIds = await this.findRecordedSuggestionIds(stale);
    const unrecorded = stale.filter(
      (suggestion) => !recordedIds.has(suggestion.id),
    );

    await this.supersedeSuggestions(unrecorded);
    await this.cancelJobs(userId, slot.id, context.dates);
    if (unrecorded.length === 0) return;
    await this.requeueVisibleSuggestions(userId, slot, context, unrecorded);
  }

  async handleSlotRemoved(userId: string, slot: ScheduleSlot): Promise<void> {
    const context = await this.buildContext(userId);
    const stale = await this.findEditableSuggestions(
      userId,
      slot,
      context.dates,
    );
    const recordedIds = await this.findRecordedSuggestionIds(stale);
    await this.supersedeSuggestions(
      stale.filter(
        (suggestion) =>
          suggestion.generation_status !== SuggestionGenerationStatus.Ready &&
          !recordedIds.has(suggestion.id),
      ),
    );
    await this.cancelJobs(userId, slot.id, context.dates);
  }

  private async buildContext(userId: string): Promise<ScheduleChangeContext> {
    const now = new Date();
    const [user, preference] = await Promise.all([
      this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'time_zone'],
      }),
      this.preferenceRepo.findOne({
        where: { user_id: userId },
      }),
    ]);
    const timeZone = user?.time_zone ?? 'UTC';
    const dates = [
      formatDateInTimeZone(timeZone, now),
      formatDateInTimeZone(timeZone, new Date(now.getTime() + 86_400_000)),
    ];

    return {
      now,
      dates,
      timeZone,
      leadMinutes: clampLeadTimeMinutes(
        preference?.suggestion_lead_time_minutes ?? 120,
      ),
    };
  }

  private async findEditableSuggestions(
    userId: string,
    slot: ScheduleSlot,
    dates: readonly string[],
  ): Promise<SuggestionInstance[]> {
    return this.suggestionRepo.find({
      where: {
        user_id: userId,
        slot_id: slot.id,
        request_source: SuggestionRequestSource.Scheduled,
        target_date: In([...dates]),
        generation_status: Not(SuggestionGenerationStatus.Superseded),
      },
      order: { target_date: 'ASC', created_at: 'DESC' },
    });
  }

  private async findRecordedSuggestionIds(
    suggestions: readonly SuggestionInstance[],
  ): Promise<Set<string>> {
    if (suggestions.length === 0) return new Set();
    const logs = await this.applicationLogRepo.find({
      where: {
        suggestion_instance_id: In(
          suggestions.map((suggestion) => suggestion.id),
        ),
      },
      select: ['suggestion_instance_id'],
    });
    return new Set(
      logs
        .map((log) => log.suggestion_instance_id)
        .filter((id): id is string => Boolean(id)),
    );
  }

  private async supersedeSuggestions(
    suggestions: readonly SuggestionInstance[],
  ): Promise<void> {
    if (suggestions.length === 0) return;
    for (const suggestion of suggestions) {
      suggestion.generation_status = SuggestionGenerationStatus.Superseded;
    }
    await this.suggestionRepo.update(
      { id: In(suggestions.map((suggestion) => suggestion.id)) },
      { generation_status: SuggestionGenerationStatus.Superseded },
    );
  }

  private async cancelJobs(
    userId: string,
    slotId: string,
    dates: readonly string[],
  ): Promise<void> {
    if (dates.length === 0) return;
    await this.jobRepo.update(
      {
        user_id: userId,
        slot_id: slotId,
        request_source: SuggestionRequestSource.Scheduled,
        target_date: In([...dates]),
        status: In([
          SuggestionGenerationJobStatus.Queued,
          SuggestionGenerationJobStatus.Running,
        ]),
      },
      {
        status: SuggestionGenerationJobStatus.Cancelled,
        locked_at: null,
        locked_by: null,
        last_error: 'schedule_change',
      },
    );
  }

  private async requeueVisibleSuggestions(
    userId: string,
    slot: ScheduleSlot,
    context: ScheduleChangeContext,
    superseded: readonly SuggestionInstance[],
  ): Promise<void> {
    for (const targetDate of context.dates) {
      if (!matchesDayOfWeek(targetDate, slot.day_of_week)) continue;
      const slotInstant = buildSlotInstant(
        targetDate,
        slot.slot_time,
        context.timeZone,
      );
      const visibleAt = new Date(
        slotInstant.getTime() - context.leadMinutes * 60_000,
      );
      if (
        visibleAt.getTime() > context.now.getTime() ||
        slotInstant.getTime() <= context.now.getTime()
      ) {
        continue;
      }

      const replacement = await this.createPendingSuggestion(
        userId,
        slot,
        targetDate,
        visibleAt,
        superseded.find((suggestion) => suggestion.target_date === targetDate),
      );
      await requeueSuggestionGenerationJob(this.jobRepo, {
        user_id: userId,
        slot_id: slot.id,
        suggestion_instance_id: replacement.id,
        request_source: SuggestionRequestSource.Scheduled,
        target_date: targetDate,
        target_time: slot.slot_time,
        visible_at: visibleAt,
        status: SuggestionGenerationJobStatus.Queued,
        attempt_count: 0,
        run_after: new Date(),
        last_error: 'schedule_change',
      });
    }
  }

  private async createPendingSuggestion(
    userId: string,
    slot: ScheduleSlot,
    targetDate: string,
    visibleAt: Date,
    previous: SuggestionInstance | undefined,
  ): Promise<SuggestionInstance> {
    return this.suggestionRepo.save(
      this.suggestionRepo.create({
        user_id: userId,
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
        has_reaction_signal: previous?.has_reaction_signal ?? false,
        simplified_for_reaction: previous?.simplified_for_reaction ?? false,
        supersedes_id: previous?.id ?? null,
        ai_error: null,
        ai_retry_count: 0,
      }),
    );
  }
}

function matchesDayOfWeek(targetDate: string, dayOfWeek: DayOfWeek): boolean {
  const date = new Date(`${targetDate}T12:00:00.000Z`);
  return DATE_DAY_LOOKUP[date.getUTCDay()] === dayOfWeek;
}
