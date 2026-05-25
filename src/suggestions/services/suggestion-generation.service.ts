import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { NotificationsService } from '../../notifications/notifications.service';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionAiGenerator } from './suggestion-ai-generator';
import { SuggestionGenerationContextService } from './suggestion-generation-context.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { RoutineBreakService } from './routine-break.service';
import {
  ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
  SuggestionGenerationStatus,
  SuggestionRequestSource,
} from '../suggestions.constants';
import { SuggestionGenerationPersistenceService } from './suggestion-generation-persistence.service';
import {
  hasScheduledSlotElapsed,
  scheduledJobStillMatchesSlot,
} from './suggestion-scheduled-job-guards';
import {
  dispatchSuggestionReadyNotification,
  recordSuggestionGenerationOutcome,
} from './suggestion-generation-events';
import { sanitizeSuggestionGenerationOutput } from './suggestion-generation-output-sanitizer';
import type {
  OnDemandSuggestionJobSubjects,
  SuggestionJobSubjects,
} from './suggestion-generation-subjects';

const SCHEDULE_SLOT_UNAVAILABLE_JOB_REASON = 'schedule_slot_unavailable';
const SCHEDULE_SLOT_CHANGED_JOB_REASON = 'schedule_slot_changed';
const SCHEDULE_SLOT_ELAPSED_JOB_REASON = 'schedule_slot_elapsed';

@Injectable()
export class SuggestionGenerationService {
  private readonly logger = new Logger(SuggestionGenerationService.name);

  constructor(
    private readonly aiGenerator: SuggestionAiGenerator,
    private readonly contextService: SuggestionGenerationContextService,
    private readonly persistence: SuggestionGenerationPersistenceService,
    private readonly notifications: NotificationsService,
    private readonly observability: SuggestionObservabilityService,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly routineBreakService: RoutineBreakService,
  ) {}
  async generateForJob(job: SuggestionGenerationJob): Promise<void> {
    if (job.request_source === SuggestionRequestSource.OnDemand) {
      await this.generateOnDemandForJob(job);
      return;
    }

    const subjects = await this.loadScheduledJobSubjects(job);
    if (!subjects) return;
    const { targetDate, targetTime, slot, user } = subjects;
    if (await this.suppressScheduledIfRoutineBreakStarted(user.id, job)) {
      return;
    }
    if (await this.suppressScheduledIfSlotElapsed(user, job, targetDate)) {
      return;
    }

    const inputs = await this.contextService.buildScheduled({
      user,
      job,
      slot,
      targetDate,
      targetTime,
    });
    const output = sanitizeSuggestionGenerationOutput(
      await this.aiGenerator.generate(inputs),
    );
    if (await this.suppressScheduledIfRoutineBreakStarted(user.id, job)) {
      return;
    }
    if (await this.suppressScheduledIfSlotElapsed(user, job, targetDate)) {
      return;
    }

    const savedInstance = await this.persistence.persistScheduled(
      user,
      job,
      slot,
      inputs,
      output,
    );
    await recordSuggestionGenerationOutcome({
      observability: this.observability,
      userId: user.id,
      jobId: job.id,
      instance: savedInstance,
      output,
    });
    if (await this.routineBreakService.isRoutineBreakActive(user.id)) {
      this.logger.log(
        `Suggestion ${savedInstance.id} generated before routine break notification dispatch; suppressing suggestion_ready.`,
      );
      return;
    }
    await dispatchSuggestionReadyNotification({
      notifications: this.notifications,
      observability: this.observability,
      logger: this.logger,
      userId: user.id,
      slotId: slot.id,
      targetDate,
      targetTime,
      daypart: savedInstance.daypart,
      steps: output.steps,
      suggestionInstanceId: savedInstance.id,
      jobId: job.id,
    });
  }

  private async generateOnDemandForJob(
    job: SuggestionGenerationJob,
  ): Promise<void> {
    const subjects = await this.loadOnDemandJobSubjects(job);
    if (!subjects) return;

    const { targetDate, targetTime, suggestion, user } = subjects;
    if (await this.failOnDemandIfRoutineBreakStarted(user.id, job)) {
      return;
    }

    const inputs = await this.contextService.buildOnDemand({
      user,
      job,
      suggestion,
      targetDate,
      targetTime,
    });
    const output = sanitizeSuggestionGenerationOutput(
      await this.aiGenerator.generate(inputs),
    );
    if (await this.failOnDemandIfRoutineBreakStarted(user.id, job)) {
      return;
    }

    const savedInstance = await this.persistence.persistOnDemand(
      user,
      job,
      suggestion,
      inputs,
      output,
    );
    await recordSuggestionGenerationOutcome({
      observability: this.observability,
      userId: user.id,
      jobId: job.id,
      instance: savedInstance,
      output,
    });
    if (await this.routineBreakService.isRoutineBreakActive(user.id)) {
      this.logger.log(
        `On-demand suggestion ${savedInstance.id} generated before routine break notification dispatch; suppressing suggestion_ready.`,
      );
      return;
    }
    await dispatchSuggestionReadyNotification({
      notifications: this.notifications,
      observability: this.observability,
      logger: this.logger,
      userId: user.id,
      slotId: null,
      targetDate,
      targetTime,
      daypart: savedInstance.daypart,
      steps: output.steps,
      suggestionInstanceId: savedInstance.id,
      jobId: job.id,
    });
  }

  private async loadScheduledJobSubjects(
    job: SuggestionGenerationJob,
  ): Promise<SuggestionJobSubjects | null> {
    const targetDate = toDateOnlyString(job.target_date);
    const targetTime = toTimeOnlyString(job.target_time);
    job.target_date = targetDate;
    job.target_time = targetTime;
    if (!job.slot_id) {
      this.logger.warn(`Scheduled job ${job.id} is missing slot_id`);
      return null;
    }

    const slot = await this.slotRepo.findOne({
      where: { id: job.slot_id, user_id: job.user_id, deleted_at: IsNull() },
      relations: ['steps', 'steps.product'],
    });
    if (!slot) {
      this.logger.warn(
        `Slot ${job.slot_id} not found or deleted for job ${job.id}`,
      );
      await this.supersedePendingScheduledSuggestion(job);
      return null;
    }
    if (!scheduledJobStillMatchesSlot(job, slot, targetDate, targetTime)) {
      this.logger.warn(
        `Slot ${job.slot_id} changed after job ${job.id} was queued`,
      );
      await this.supersedePendingScheduledSuggestion(
        job,
        SCHEDULE_SLOT_CHANGED_JOB_REASON,
      );
      return null;
    }

    const user = await this.userRepo.findOne({ where: { id: job.user_id } });
    if (!user) {
      this.logger.warn(`User ${job.user_id} not found for job ${job.id}`);
      return null;
    }

    return { targetDate, targetTime, slot, user };
  }

  private async supersedePendingScheduledSuggestion(
    job: SuggestionGenerationJob,
    reason = SCHEDULE_SLOT_UNAVAILABLE_JOB_REASON,
  ): Promise<void> {
    if (!job.slot_id) return;
    await this.suggestionRepo.update(
      {
        user_id: job.user_id,
        slot_id: job.slot_id,
        target_date: toDateOnlyString(job.target_date),
        generation_status: In([
          SuggestionGenerationStatus.Pending,
          SuggestionGenerationStatus.Generating,
        ]),
      },
      {
        generation_status: SuggestionGenerationStatus.Superseded,
        ai_error: reason,
      },
    );
  }

  private async loadOnDemandJobSubjects(
    job: SuggestionGenerationJob,
  ): Promise<OnDemandSuggestionJobSubjects | null> {
    const targetDate = toDateOnlyString(job.target_date);
    const targetTime = toTimeOnlyString(job.target_time);
    job.target_date = targetDate;
    job.target_time = targetTime;
    if (!job.suggestion_instance_id) {
      this.logger.warn(`On-demand job ${job.id} is missing suggestion id`);
      return null;
    }

    const suggestion = await this.suggestionRepo.findOne({
      where: { id: job.suggestion_instance_id, user_id: job.user_id },
    });
    if (!suggestion) {
      this.logger.warn(
        `On-demand suggestion ${job.suggestion_instance_id} not found for job ${job.id}`,
      );
      return null;
    }
    if (suggestion.generation_status === SuggestionGenerationStatus.Ready) {
      return null;
    }
    if (suggestion.request_source !== SuggestionRequestSource.OnDemand) {
      this.logger.warn(
        `Suggestion ${suggestion.id} is not an on-demand suggestion for job ${job.id}`,
      );
      return null;
    }

    const user = await this.userRepo.findOne({ where: { id: job.user_id } });
    if (!user) {
      this.logger.warn(`User ${job.user_id} not found for job ${job.id}`);
      return null;
    }

    return { targetDate, targetTime, suggestion, user };
  }

  private async suppressScheduledIfRoutineBreakStarted(
    userId: string,
    job: SuggestionGenerationJob,
  ): Promise<boolean> {
    if (!(await this.routineBreakService.isRoutineBreakActive(userId))) {
      return false;
    }
    const slotId = job.slot_id;
    if (!slotId) return false;
    const targetDate = toDateOnlyString(job.target_date);

    await this.suggestionRepo.update(
      {
        user_id: userId,
        slot_id: slotId,
        target_date: targetDate,
        generation_status: Not(SuggestionGenerationStatus.Superseded),
      },
      {
        generation_status: SuggestionGenerationStatus.Superseded,
        ai_error: ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
        ai_retry_count: job.attempt_count,
      },
    );
    await this.observability.record({
      kind: 'generation_failed',
      severity: 'warning',
      userId,
      jobId: job.id,
      metadata: {
        reason: ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
      },
    });
    this.logger.log(
      `Suppressed suggestion generation for job ${job.id} because a routine break became active.`,
    );
    return true;
  }

  private async suppressScheduledIfSlotElapsed(
    user: User,
    job: SuggestionGenerationJob,
    targetDate: string,
  ): Promise<boolean> {
    const targetTime = toTimeOnlyString(job.target_time);
    const timeZone = resolveEffectiveTimeZone(user.time_zone, null);
    if (
      !hasScheduledSlotElapsed({
        targetDate,
        targetTime,
        timeZone,
      })
    ) {
      return false;
    }

    await this.supersedePendingScheduledSuggestion(
      job,
      SCHEDULE_SLOT_ELAPSED_JOB_REASON,
    );
    await this.observability.record({
      kind: 'generation_failed',
      severity: 'warning',
      userId: user.id,
      jobId: job.id,
      metadata: {
        reason: SCHEDULE_SLOT_ELAPSED_JOB_REASON,
        targetDate,
        targetTime,
      },
    });
    this.logger.log(
      `Suppressed suggestion generation for job ${job.id} because the scheduled time has elapsed.`,
    );
    return true;
  }

  private async failOnDemandIfRoutineBreakStarted(
    userId: string,
    job: SuggestionGenerationJob,
  ): Promise<boolean> {
    if (!(await this.routineBreakService.isRoutineBreakActive(userId))) {
      return false;
    }
    await this.suggestionRepo.update(
      {
        user_id: userId,
        id: job.suggestion_instance_id ?? '',
        generation_status: Not(SuggestionGenerationStatus.Superseded),
      },
      {
        generation_status: SuggestionGenerationStatus.Failed,
        ai_error: ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
        ai_retry_count: job.attempt_count,
      },
    );
    await this.observability.record({
      kind: 'generation_failed',
      severity: 'warning',
      userId,
      jobId: job.id,
      suggestionInstanceId: job.suggestion_instance_id ?? null,
      metadata: {
        reason: ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
        requestSource: SuggestionRequestSource.OnDemand,
      },
    });
    return true;
  }
}
