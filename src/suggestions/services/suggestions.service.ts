import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import {
  toDateOnlyString,
  toIsoString,
  toTimeOnlyString,
} from '../../common/utils/date';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { User } from '../../users/entities/user.entity';
import {
  RegenerateSuggestionDto,
  SuggestionHistoryExportFile,
  SuggestionHistoryDayDto,
  SuggestionHistoryListQueryDto,
  SuggestionHistoryListResponseDto,
} from '../dto/suggestion-history.dto';
import { SuggestionInstanceResponseDto } from '../dto/suggestion-instance-response.dto';
import {
  TodaysSuggestionResponseDto,
  TodaysSuggestionSlotDto,
} from '../dto/todays-suggestion-response.dto';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SUGGESTION_LEAD_TIME_DEFAULT_MINUTES } from '../suggestions.constants';
import { mapDayOfWeekShort } from './suggestion-history.helpers';
import {
  buildSlotInstant,
  clampLeadTimeMinutes,
  formatDateInTimeZone,
} from './suggestion-helpers';
import { SuggestionHistoryReader } from './suggestion-history-reader.service';
import { SuggestionHistoryExportService } from './suggestion-history-export.service';
import { computeSuggestionLifecycle } from './suggestion-lifecycle';
import { requeueSuggestionGenerationJob } from './suggestion-generation-job-queue';
import { SuggestionAiUsageGuard } from './suggestion-ai-usage-guard.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import {
  buildPausedActiveNames,
  buildTodaySlotDto,
  buildTodaySummary,
} from './todays-suggestion-response.mapper';
import { TodaysSuggestionReactionService } from './todays-suggestion-reaction.service';
import { SuggestionTodayActionService } from './suggestion-today-action.service';

/**
 * Read-and-orchestrate service for the suggestion engine.
 *
 *  - `getTodaysSuggestion` assembles the Today's Suggestion page response
 *    by joining the user's schedule for today's day-of-week with their
 *    suggestion_instances for the current calendar date and the latest
 *    application log per slot.
 *  - `getSuggestion` returns a single suggestion (used by the "Why this
 *    routine" drawer).
 *  - `regenerateSuggestion` supersedes an existing instance and queues a
 *    new generation job. The actual generation happens in the worker.
 *  - `getHistory` returns the date-grouped past records for the History
 *    page; `getHistoryDay` returns a single past day with full slot
 *    detail.
 *
 * Notifications and AI generation belong to other services.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(SuggestionGenerationJob)
    private readonly jobRepo: Repository<SuggestionGenerationJob>,
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
    @InjectRepository(ApplicationLog)
    private readonly applicationLogRepo: Repository<ApplicationLog>,
    @InjectRepository(UserNotificationPreference)
    private readonly preferenceRepo: Repository<UserNotificationPreference>,
    private readonly historyReader: SuggestionHistoryReader,
    private readonly historyExporter: SuggestionHistoryExportService,
    private readonly usageGuard: SuggestionAiUsageGuard,
    private readonly observability: SuggestionObservabilityService,
    private readonly reactionService: TodaysSuggestionReactionService,
    private readonly todayActionService: SuggestionTodayActionService,
  ) {}

  async getTodaysSuggestion(
    user: User,
    requestTimeZone: string | null,
  ): Promise<TodaysSuggestionResponseDto> {
    const timeZone = resolveEffectiveTimeZone(user.time_zone, requestTimeZone);
    const now = new Date();
    const today = formatDateInTimeZone(timeZone, now);
    const dayOfWeek = mapDayOfWeekShort(timeZone, now);
    const leadTimeMinutes = await this.resolveLeadTimeMinutes(user.id);

    const slots = await this.slotRepo.find({
      where: { user_id: user.id, day_of_week: dayOfWeek },
      relations: ['steps', 'steps.product'],
      order: { slot_time: 'ASC' },
    });

    const suggestions = await this.suggestionRepo.find({
      where: {
        user_id: user.id,
        target_date: today,
        generation_status: Not('superseded' as const),
      },
      relations: ['steps', 'steps.product'],
    });

    const applications = await this.applicationLogRepo.find({
      where: {
        user_id: user.id,
        target_date: today,
        suggestion_instance_id: Not(IsNull()),
      },
      relations: ['items', 'items.product', 'items.substituted_with_product'],
    });

    const suggestionBySlot = new Map<string, SuggestionInstance>();
    for (const suggestion of suggestions) {
      if (!suggestion.slot_id) continue;
      const existing = suggestionBySlot.get(suggestion.slot_id);
      if (!existing) {
        suggestionBySlot.set(suggestion.slot_id, suggestion);
        continue;
      }
      // Prefer the most recently generated, non-superseded one.
      if (
        (suggestion.generated_at?.getTime() ?? 0) >
        (existing.generated_at?.getTime() ?? 0)
      ) {
        suggestionBySlot.set(suggestion.slot_id, suggestion);
      }
    }

    const applicationLogBySuggestion = new Map<string, ApplicationLog>();
    for (const log of applications) {
      if (!log.suggestion_instance_id) continue;
      const existing = applicationLogBySuggestion.get(
        log.suggestion_instance_id,
      );
      if (
        !existing ||
        (log.updated_at?.getTime() ?? 0) > (existing.updated_at?.getTime() ?? 0)
      ) {
        applicationLogBySuggestion.set(log.suggestion_instance_id, log);
      }
    }
    const gapActionMaps = await this.todayActionService.getGapActionMaps(
      user.id,
      suggestions.map((suggestion) => suggestion.id),
    );
    const reminderSnoozeMap =
      await this.todayActionService.getReminderSnoozeMap(
        user.id,
        suggestions.map((suggestion) => suggestion.id),
      );

    const slotDtos: TodaysSuggestionSlotDto[] = slots.map((slot) => {
      const suggestion = suggestionBySlot.get(slot.id) ?? null;
      const slotStartsAt = buildSlotInstant(today, slot.slot_time, timeZone);
      const visibleAt =
        suggestion?.visible_at ??
        new Date(slotStartsAt.getTime() - leadTimeMinutes * 60_000);
      const applicationLog = suggestion
        ? (applicationLogBySuggestion.get(suggestion.id) ?? null)
        : null;
      const lifecycle = computeSuggestionLifecycle({
        suggestion,
        applicationLog,
        targetDate: today,
        slotTime: slot.slot_time,
        visibleAt,
        now,
        timeZone,
      });
      return buildTodaySlotDto({
        slot,
        suggestion,
        applicationLog,
        gapActionByKey: suggestion
          ? gapActionMaps.get(suggestion.id)
          : undefined,
        recordingReminderSnoozedUntil: suggestion
          ? (reminderSnoozeMap.get(suggestion.id) ?? null)
          : null,
        visibleAt,
        lifecycle,
      });
    });

    const reactionAlert = await this.reactionService.getReactionAlert(
      user.id,
      today,
      buildPausedActiveNames(suggestions),
    );

    return {
      date: today,
      timeZone,
      generatedAt: toIsoString(now),
      leadTimeMinutes,
      summary: buildTodaySummary(slotDtos),
      weatherSummary: null,
      slots: slotDtos,
      reactionAlert,
    };
  }

  async getSuggestion(
    user: User,
    suggestionId: string,
  ): Promise<SuggestionInstanceResponseDto> {
    const suggestion = await this.suggestionRepo.findOne({
      where: { id: suggestionId },
      relations: ['steps', 'steps.product'],
    });
    if (!suggestion) {
      throw new NotFoundException('Suggestion not found.');
    }
    if (suggestion.user_id !== user.id) {
      throw new ForbiddenException('Suggestion belongs to another user.');
    }

    const log = await this.applicationLogRepo.findOne({
      where: {
        user_id: user.id,
        suggestion_instance_id: suggestion.id,
      },
    });
    const gapActionMaps = await this.todayActionService.getGapActionMaps(
      user.id,
      [suggestion.id],
    );

    return SuggestionInstanceResponseDto.fromEntity(suggestion, {
      applicationLogId: log?.id ?? null,
      gapActionByKey: gapActionMaps.get(suggestion.id),
    });
  }

  async regenerateSuggestion(
    user: User,
    suggestionId: string,
    payload: RegenerateSuggestionDto,
  ): Promise<SuggestionInstanceResponseDto> {
    const existing = await this.suggestionRepo.findOne({
      where: { id: suggestionId },
    });
    if (!existing) {
      throw new NotFoundException('Suggestion not found.');
    }
    if (existing.user_id !== user.id) {
      throw new ForbiddenException('Suggestion belongs to another user.');
    }
    const usageDecision = await this.usageGuard.evaluateRegeneration(user.id);
    if (!usageDecision.allowed) {
      await this.observability.record({
        kind: 'ai_budget_blocked',
        severity: 'warning',
        userId: user.id,
        suggestionInstanceId: existing.id,
        metadata: {
          reason: usageDecision.blockedReason,
          generationCountToday: usageDecision.generationCountToday,
          regenerationCountToday: usageDecision.regenerationCountToday,
          estimatedCostTodayUsd: usageDecision.estimatedCostTodayUsd,
        },
      });
      throw new HttpException(
        'Daily AI suggestion budget reached. Try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Mark the prior instance superseded so the new one becomes active.
    existing.generation_status = 'superseded';
    await this.suggestionRepo.save(existing);

    // Queue a fresh job for the same slot+date so the worker picks it up.
    if (!existing.slot_id) {
      throw new ConflictException(
        'This suggestion is no longer linked to a schedule slot.',
      );
    }

    const now = new Date();
    const targetDate = toDateOnlyString(existing.target_date);
    const targetTime = toTimeOnlyString(existing.target_time);
    const replacement = await this.suggestionRepo.save(
      this.suggestionRepo.create({
        user_id: user.id,
        slot_id: existing.slot_id,
        target_date: targetDate,
        target_time: targetTime,
        daypart: existing.daypart,
        mode: existing.mode,
        generation_status: 'pending',
        visible_at: now,
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
        has_reaction_signal: existing.has_reaction_signal,
        simplified_for_reaction: existing.simplified_for_reaction,
        supersedes_id: existing.id,
        ai_error: null,
        ai_retry_count: 0,
      }),
    );

    await requeueSuggestionGenerationJob(this.jobRepo, {
      user_id: user.id,
      slot_id: existing.slot_id,
      target_date: targetDate,
      target_time: targetTime,
      visible_at: now,
      status: 'queued',
      attempt_count: 0,
      run_after: now,
      last_error: payload.reason ? `regenerate:${payload.reason}` : null,
    });

    return SuggestionInstanceResponseDto.fromEntity(replacement);
  }

  async getHistory(
    user: User,
    requestTimeZone: string | null,
    query: SuggestionHistoryListQueryDto,
  ): Promise<SuggestionHistoryListResponseDto> {
    return this.historyReader.getHistory(user, requestTimeZone, query);
  }

  async exportHistoryCsv(
    user: User,
    requestTimeZone: string | null,
    query: SuggestionHistoryListQueryDto,
  ): Promise<SuggestionHistoryExportFile> {
    return this.historyExporter.exportCsv(user, requestTimeZone, query);
  }

  async getHistoryDay(
    user: User,
    requestTimeZone: string | null,
    date: string,
  ): Promise<SuggestionHistoryDayDto> {
    return this.historyReader.getHistoryDay(user, requestTimeZone, date);
  }

  private async resolveLeadTimeMinutes(userId: string): Promise<number> {
    const prefs = await this.preferenceRepo.findOne({
      where: { user_id: userId },
    });
    return clampLeadTimeMinutes(
      prefs?.suggestion_lead_time_minutes,
      SUGGESTION_LEAD_TIME_DEFAULT_MINUTES,
    );
  }
}
