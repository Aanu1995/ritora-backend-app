import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { SlotModeValue } from '../schedule/dto/schedule.constants';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { UserNotificationPreference } from '../notifications/entities/user-notification-preference.entity';
import { User } from '../users/entities/user.entity';
import { SuggestionGenerationJob } from '../suggestions/entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import {
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
  SuggestionMode,
} from '../suggestions/suggestions.constants';
import { RoutineBreakService } from '../suggestions/services/routine-break.service';
import { mapDayOfWeekShort } from '../suggestions/services/suggestion-history.helpers';
import {
  buildSlotInstant,
  clampLeadTimeMinutes,
  compareClockTimes,
  deriveSuggestionDaypart,
} from '../suggestions/services/suggestion-helpers';
import {
  requeueSuggestionGenerationJob,
  type SuggestionGenerationJobDraft,
} from '../suggestions/services/suggestion-generation-job-queue';
import { hasScheduledSlotElapsed } from '../suggestions/services/suggestion-scheduled-job-guards';
import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from './application-tracking.constants';
import { ApplicationLogResponseDto } from './dto/application-log-response.dto';

@Injectable()
export class ApplicationReactiveRegenerationService {
  constructor(
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(SuggestionGenerationJob)
    private readonly jobRepo: Repository<SuggestionGenerationJob>,
    @InjectRepository(UserNotificationPreference)
    private readonly preferenceRepo: Repository<UserNotificationPreference>,
    private readonly routineBreakService: RoutineBreakService,
  ) {}

  async queueAfterApplicationChange(
    user: User,
    log: ApplicationLogResponseDto,
  ): Promise<void> {
    if (!log.targetTime || !hasRegenerationSignal(log)) return;
    if (await this.routineBreakService.isRoutineBreakActive(user.id)) return;
    const timeZone = user.time_zone ?? 'UTC';
    const dayOfWeek = mapDayOfWeekShort(
      timeZone,
      new Date(`${log.targetDate}T12:00:00Z`),
    );
    const slots = await this.slotRepo.find({
      where: { user_id: user.id, day_of_week: dayOfWeek, deleted_at: IsNull() },
      order: { slot_time: 'ASC' },
    });
    const futureSlots = slots.filter(
      (slot) => compareClockTimes(slot.slot_time, log.targetTime ?? '') > 0,
    );
    if (futureSlots.length === 0) return;
    const prefs = await this.preferenceRepo.findOne({
      where: { user_id: user.id },
    });
    const leadMinutes = clampLeadTimeMinutes(
      prefs?.suggestion_lead_time_minutes ?? 120,
    );
    const now = new Date();
    const existingSuggestions = await this.suggestionRepo.find({
      where: {
        user_id: user.id,
        slot_id: In(futureSlots.map((slot) => slot.id)),
        target_date: log.targetDate,
        generation_status: Not(SuggestionGenerationStatus.Superseded),
      },
    });
    const suggestionBySlot = new Map(
      existingSuggestions.map((suggestion) => [suggestion.slot_id, suggestion]),
    );
    const suggestionIdsToSupersede: string[] = [];
    const pendingSuggestions: SuggestionInstance[] = [];
    const jobDrafts: SuggestionGenerationJobDraft[] = [];

    for (const slot of futureSlots) {
      const slotInstant = buildSlotInstant(
        log.targetDate,
        slot.slot_time,
        timeZone,
      );
      if (
        hasScheduledSlotElapsed({
          targetDate: log.targetDate,
          targetTime: slot.slot_time,
          timeZone,
          now,
        })
      ) {
        continue;
      }
      const visibleAt = new Date(slotInstant.getTime() - leadMinutes * 60_000);
      if (visibleAt.getTime() > now.getTime()) continue;

      const existing = suggestionBySlot.get(slot.id);
      let supersedesId: string | null = null;
      if (
        existing?.generation_status === SuggestionGenerationStatus.Ready ||
        existing?.generation_status === SuggestionGenerationStatus.Failed
      ) {
        supersedesId = existing.id;
        existing.generation_status = SuggestionGenerationStatus.Superseded;
        suggestionIdsToSupersede.push(existing.id);
      }
      if (
        existing?.generation_status === SuggestionGenerationStatus.Generating
      ) {
        continue;
      }
      if (!existing || supersedesId) {
        pendingSuggestions.push(
          this.suggestionRepo.create({
            user_id: user.id,
            slot_id: slot.id,
            target_date: log.targetDate,
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
            has_reaction_signal: existing?.has_reaction_signal ?? false,
            simplified_for_reaction: existing?.simplified_for_reaction ?? false,
            supersedes_id: supersedesId,
            ai_error: null,
            ai_retry_count: 0,
          }),
        );
      }
      jobDrafts.push({
        user_id: user.id,
        slot_id: slot.id,
        target_date: log.targetDate,
        target_time: slot.slot_time,
        visible_at: visibleAt,
        status: SuggestionGenerationJobStatus.Queued,
        attempt_count: 0,
        run_after: now,
        last_error: `reactive:${log.id}`,
      });
    }

    const uniqueSupersededSuggestionIds = Array.from(
      new Set(suggestionIdsToSupersede),
    );
    if (uniqueSupersededSuggestionIds.length > 0) {
      await this.suggestionRepo.update(
        { id: In(uniqueSupersededSuggestionIds) },
        { generation_status: SuggestionGenerationStatus.Superseded },
      );
    }
    if (pendingSuggestions.length > 0) {
      await this.suggestionRepo.save(pendingSuggestions);
    }
    await Promise.all(
      jobDrafts.map((draft) =>
        requeueSuggestionGenerationJob(this.jobRepo, draft),
      ),
    );
  }
}

function hasRegenerationSignal(log: ApplicationLogResponseDto): boolean {
  return (
    log.hasBeenEdited ||
    log.items.some(
      (item) =>
        item.status === ApplicationItemStatus.Skipped ||
        item.status === ApplicationItemStatus.Substituted ||
        item.isAdHoc ||
        item.itemSource === ApplicationItemSource.AddedShelf ||
        item.itemSource === ApplicationItemSource.AddedOffShelf,
    )
  );
}
