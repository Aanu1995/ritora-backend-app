import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { EnvironmentContextService } from '../../environment-intelligence/environment-context.service';
import { buildEnvironmentAdaptationPolicy } from '../../environment-intelligence/environment-adaptation-policy';
import { toIsoString } from '../../common/utils/date';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
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
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { mapDayOfWeekShort } from './suggestion-history.helpers';
import {
  buildSlotInstant,
  formatDateInTimeZone,
  formatTimeInTimeZone,
} from './suggestion-helpers';
import { SuggestionHistoryReader } from './suggestion-history-reader.service';
import { SuggestionHistoryExportService } from './suggestion-history-export.service';
import { computeSuggestionLifecycle } from './suggestion-lifecycle';
import { SuggestionRegenerationService } from './suggestion-regeneration.service';
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
import { resolveSuggestionLeadTimeMinutes } from './suggestion-preferences';
import {
  SuggestionGenerationStatus,
  SuggestionRequestSource,
} from '../suggestions.constants';

@Injectable()
export class SuggestionsService {
  constructor(
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
    @InjectRepository(ApplicationLog)
    private readonly applicationLogRepo: Repository<ApplicationLog>,
    @InjectRepository(UserNotificationPreference)
    private readonly preferenceRepo: Repository<UserNotificationPreference>,
    @InjectRepository(SkinProfile)
    private readonly skinProfileRepo: Repository<SkinProfile>,
    private readonly historyReader: SuggestionHistoryReader,
    private readonly historyExporter: SuggestionHistoryExportService,
    private readonly regenerationService: SuggestionRegenerationService,
    private readonly reactionService: TodaysSuggestionReactionService,
    private readonly todayActionService: SuggestionTodayActionService,
    private readonly routineBreakService: RoutineBreakService,
    private readonly environmentContext: EnvironmentContextService,
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

    const skinProfile = await this.skinProfileRepo.findOne({
      where: { user_id: user.id },
    });
    const environment = await this.environmentContext.buildContext({
      userId: user.id,
      profile: skinProfile,
      targetDate: today,
      targetTime: formatTimeInTimeZone(timeZone, now),
      timeZone,
      now,
    });
    const environmentPolicy = environment
      ? buildEnvironmentAdaptationPolicy(environment.summary)
      : null;

    return {
      date: today,
      timeZone,
      generatedAt: toIsoString(now),
      leadTimeMinutes,
      summary: buildTodaySummary(responseSlots, responseOnDemand),
      weatherSummary: environment
        ? {
            temperatureCelsius: environment.summary.temperatureCelsius,
            uvIndex: environment.summary.uvIndex,
            humidity: environment.summary.humidity,
            conditionLabel: environment.summary.conditionLabel,
          }
        : null,
      environmentSummary: environment?.summary ?? null,
      environmentAlerts: environmentPolicy?.alerts ?? [],
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
    return this.regenerationService.regenerateSuggestion(
      user,
      suggestionId,
      payload,
    );
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
