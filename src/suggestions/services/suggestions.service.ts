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
import { mapDayOfWeekShort } from './suggestion-history.helpers';
import { buildSlotInstant, formatDateInTimeZone } from './suggestion-helpers';
import { SuggestionHistoryReader } from './suggestion-history-reader.service';
import { SuggestionHistoryExportService } from './suggestion-history-export.service';
import { computeSuggestionLifecycle } from './suggestion-lifecycle';
import { requeueSuggestionGenerationJob } from './suggestion-generation-job-queue';
import { SuggestionAiUsageGuard } from './suggestion-ai-usage-guard.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { RoutineBreakService } from './routine-break.service';
import {
  buildPausedActiveNames,
  buildTodayOnDemandDto,
  buildTodaySlotDto,
  buildTodaySummary,
  shouldExposeTodaySlot,
} from './todays-suggestion-response.mapper';
import { TodaysSuggestionReactionService } from './todays-suggestion-reaction.service';
import { SuggestionTodayActionService } from './suggestion-today-action.service';
import { includeHistoricalSlotsForReadySuggestions } from './today-schedule-slot-resolver';
import {
  mapLatestApplicationLogBySuggestion,
  mapLatestSuggestionBySlot,
} from './today-suggestion-maps';
import { hasScheduledSlotElapsed } from './suggestion-scheduled-job-guards';
import { resolveSuggestionLeadTimeMinutes } from './suggestion-preferences';
import {
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
  SuggestionRequestSource,
} from '../suggestions.constants';

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
    private readonly routineBreakService: RoutineBreakService,
  ) {}

  async getTodaysSuggestion(
    user: User,
    requestTimeZone: string | null,
  ): Promise<TodaysSuggestionResponseDto> {
    const timeZone = resolveEffectiveTimeZone(user.time_zone, requestTimeZone);
    const now = new Date();
    const today = formatDateInTimeZone(timeZone, now);
    const dayOfWeek = mapDayOfWeekShort(timeZone, now);
    const leadTimeMinutes = await resolveSuggestionLeadTimeMinutes(
      this.preferenceRepo,
      user.id,
    );
    const { routineBreak } = await this.routineBreakService.getBreakState(user);

    const activeSlots = await this.slotRepo.find({
      where: { user_id: user.id, day_of_week: dayOfWeek, deleted_at: IsNull() },
      relations: ['steps', 'steps.product'],
      order: { slot_time: 'ASC' },
    });

    const suggestions = await this.suggestionRepo.find({
      where: {
        user_id: user.id,
        target_date: today,
        generation_status: Not(SuggestionGenerationStatus.Superseded),
      },
      relations: ['steps', 'steps.product'],
    });
    const scheduledSuggestions = suggestions.filter(
      (suggestion) =>
        (suggestion.request_source ?? SuggestionRequestSource.Scheduled) ===
        SuggestionRequestSource.Scheduled,
    );
    const slots = await includeHistoricalSlotsForReadySuggestions({
      slotRepo: this.slotRepo,
      userId: user.id,
      activeSlots,
      scheduledSuggestions,
    });
    const onDemandSuggestions = suggestions.filter(
      (suggestion) =>
        suggestion.request_source === SuggestionRequestSource.OnDemand,
    );

    const applications = await this.applicationLogRepo.find({
      where: {
        user_id: user.id,
        target_date: today,
        suggestion_instance_id: Not(IsNull()),
      },
      relations: ['items', 'items.product', 'items.substituted_with_product'],
    });

    const suggestionBySlot = mapLatestSuggestionBySlot(scheduledSuggestions);
    const applicationLogBySuggestion =
      mapLatestApplicationLogBySuggestion(applications);
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
    const onDemandDtos = onDemandSuggestions
      .map((suggestion) =>
        buildTodayOnDemandDto({
          suggestion,
          applicationLog: applicationLogBySuggestion.get(suggestion.id) ?? null,
          gapActionByKey: gapActionMaps.get(suggestion.id),
        }),
      )
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

    const reactionAlert = await this.reactionService.getReactionAlert(
      user.id,
      today,
      buildPausedActiveNames(scheduledSuggestions),
    );
    const visibleSlotDtos = slotDtos.filter(shouldExposeTodaySlot);
    const responseSlots =
      routineBreak?.status === 'active'
        ? visibleSlotDtos.filter(
            (slot) =>
              slot.suggestion?.generationStatus ===
              SuggestionGenerationStatus.Ready,
          )
        : visibleSlotDtos;
    const responseOnDemand =
      routineBreak?.status === 'active'
        ? onDemandDtos.filter(
            (suggestion) =>
              suggestion.suggestion.generationStatus ===
              SuggestionGenerationStatus.Ready,
          )
        : onDemandDtos;

    return {
      date: today,
      timeZone,
      generatedAt: toIsoString(now),
      leadTimeMinutes,
      summary: buildTodaySummary(responseSlots, responseOnDemand),
      weatherSummary: null,
      slots: responseSlots,
      onDemandSuggestions: responseOnDemand,
      reactionAlert,
      routineBreak: routineBreak?.status === 'active' ? routineBreak : null,
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
    if (!existing.slot_id) {
      throw new ConflictException(
        'This suggestion is no longer linked to a schedule.',
      );
    }
    if (await this.routineBreakService.isRoutineBreakActive(user.id)) {
      throw new ConflictException(
        'Routine is paused. Resume before regenerating suggestions.',
      );
    }
    const activeSlot = await this.slotRepo.findOne({
      where: {
        id: existing.slot_id,
        user_id: user.id,
        deleted_at: IsNull(),
      },
      select: ['id'],
    });
    if (!activeSlot) {
      throw new ConflictException(
        'This suggestion is linked to a schedule that was removed.',
      );
    }
    const targetDate = toDateOnlyString(existing.target_date);
    const targetTime = toTimeOnlyString(existing.target_time);
    const timeZone = resolveEffectiveTimeZone(user.time_zone, null);
    if (
      hasScheduledSlotElapsed({
        targetDate,
        targetTime,
        timeZone,
      })
    ) {
      throw new ConflictException('This suggestion time has already passed.');
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

    existing.generation_status = SuggestionGenerationStatus.Superseded;
    await this.suggestionRepo.save(existing);

    const now = new Date();
    const replacement = await this.suggestionRepo.save(
      this.suggestionRepo.create({
        user_id: user.id,
        slot_id: existing.slot_id,
        request_source: SuggestionRequestSource.Scheduled,
        request_id: null,
        request_context: null,
        target_date: targetDate,
        target_time: targetTime,
        daypart: existing.daypart,
        mode: existing.mode,
        generation_status: SuggestionGenerationStatus.Pending,
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
      status: SuggestionGenerationJobStatus.Queued,
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
}
