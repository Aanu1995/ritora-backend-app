import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { NotificationsService } from '../../notifications/notifications.service';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SuggestionAiGenerator,
  SuggestionGenerationOutput,
} from './suggestion-ai-generator';
import { SuggestionGenerationContextService } from './suggestion-generation-context.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { RoutineBreakService } from './routine-break.service';
import { ROUTINE_BREAK_SUPPRESSED_JOB_REASON } from '../suggestions.constants';
import { SuggestionGenerationPersistenceService } from './suggestion-generation-persistence.service';

type SuggestionJobSubjects = {
  targetDate: string;
  targetTime: string;
  slot: ScheduleSlot;
  user: User;
};

type OnDemandSuggestionJobSubjects = {
  targetDate: string;
  targetTime: string;
  suggestion: SuggestionInstance;
  user: User;
};

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
    if (job.request_source === 'on_demand') {
      await this.generateOnDemandForJob(job);
      return;
    }

    const subjects = await this.loadScheduledJobSubjects(job);
    if (!subjects) return;

    const { targetDate, targetTime, slot, user } = subjects;
    if (await this.suppressScheduledIfRoutineBreakStarted(user.id, job)) {
      return;
    }

    const inputs = await this.contextService.buildScheduled({
      user,
      job,
      slot,
      targetDate,
      targetTime,
    });

    const output = await this.aiGenerator.generate(inputs);
    if (await this.suppressScheduledIfRoutineBreakStarted(user.id, job)) {
      return;
    }

    const savedInstance = await this.persistence.persistScheduled(
      user,
      job,
      slot,
      inputs,
      output,
    );
    await this.recordGenerationOutcome(user.id, job.id, savedInstance, output);
    if (await this.routineBreakService.isRoutineBreakActive(user.id)) {
      this.logger.log(
        `Suggestion ${savedInstance.id} generated before routine break notification dispatch; suppressing suggestion_ready.`,
      );
      return;
    }
    await this.dispatchSuggestionReadyNotification(
      user.id,
      slot.id,
      targetDate,
      savedInstance.id,
      job.id,
    );
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
    const output = await this.aiGenerator.generate(inputs);
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
    await this.recordGenerationOutcome(user.id, job.id, savedInstance, output);
    if (await this.routineBreakService.isRoutineBreakActive(user.id)) {
      this.logger.log(
        `On-demand suggestion ${savedInstance.id} generated before routine break notification dispatch; suppressing suggestion_ready.`,
      );
      return;
    }
    await this.dispatchSuggestionReadyNotification(
      user.id,
      null,
      targetDate,
      savedInstance.id,
      job.id,
    );
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
      where: { id: job.slot_id },
      relations: ['steps', 'steps.product'],
    });
    if (!slot) {
      this.logger.warn(`Slot ${job.slot_id} not found for job ${job.id}`);
      return null;
    }

    const user = await this.userRepo.findOne({ where: { id: job.user_id } });
    if (!user) {
      this.logger.warn(`User ${job.user_id} not found for job ${job.id}`);
      return null;
    }

    return { targetDate, targetTime, slot, user };
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
      where: { id: job.suggestion_instance_id },
    });
    if (!suggestion) {
      this.logger.warn(
        `On-demand suggestion ${job.suggestion_instance_id} not found for job ${job.id}`,
      );
      return null;
    }
    if (suggestion.generation_status === 'ready') {
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
        generation_status: Not('superseded' as const),
      },
      {
        generation_status: 'superseded',
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
        generation_status: Not('superseded' as const),
      },
      {
        generation_status: 'failed',
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
        requestSource: 'on_demand',
      },
    });
    return true;
  }

  private async dispatchSuggestionReadyNotification(
    userId: string,
    slotId: string | null,
    targetDate: string,
    suggestionInstanceId: string,
    jobId: string,
  ): Promise<void> {
    try {
      await this.notifications.dispatch({
        userId,
        kind: 'suggestion_ready',
        titleKey: 'notificationsPage.kinds.suggestion_ready.title',
        bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
        deepLink: '/todays-suggestion',
        payload: {
          slotId,
          targetDate,
          requestSource: slotId ? 'scheduled' : 'on_demand',
        },
        dedupeKey: slotId
          ? `suggestion_ready:${targetDate}:${slotId}`
          : `suggestion_ready:on_demand:${suggestionInstanceId}`,
      });
    } catch (error) {
      await this.observability.record({
        kind: 'notification_failed',
        severity: 'warning',
        userId,
        suggestionInstanceId,
        jobId,
        metadata: {
          notificationKind: 'suggestion_ready',
          message: error instanceof Error ? error.message : 'unknown error',
        },
      });
      this.logger.warn(
        `Failed to dispatch suggestion_ready notification: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async recordGenerationOutcome(
    userId: string,
    jobId: string,
    instance: SuggestionInstance,
    output: SuggestionGenerationOutput,
  ): Promise<void> {
    const fallback =
      output.metadata.model.startsWith('deterministic-baseline') ||
      output.metadata.model.startsWith('fallback:');
    await this.observability.record({
      kind: fallback ? 'generation_fallback' : 'generation_completed',
      severity: fallback ? 'warning' : 'info',
      userId,
      suggestionInstanceId: instance.id,
      jobId,
      metadata: {
        model: output.metadata.model,
        promptVersion: output.metadata.promptVersion,
        durationMs: output.metadata.durationMs,
        estimatedCostUsd: output.metadata.estimatedCostUsd,
        requestSource: instance.request_source ?? 'scheduled',
      },
    });
  }
}
