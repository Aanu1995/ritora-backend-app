import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { NotificationsService } from '../../notifications/notifications.service';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionStep } from '../entities/suggestion-step.entity';
import {
  SuggestionAiGenerator,
  SuggestionGenerationInputs,
  SuggestionGenerationOutput,
} from './suggestion-ai-generator';
import { SuggestionGenerationContextService } from './suggestion-generation-context.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { buildSlotInstant, clampLeadTimeMinutes } from './suggestion-helpers';

type SuggestionJobSubjects = {
  targetDate: string;
  targetTime: string;
  slot: ScheduleSlot;
  user: User;
};

@Injectable()
export class SuggestionGenerationService {
  private readonly logger = new Logger(SuggestionGenerationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly aiGenerator: SuggestionAiGenerator,
    private readonly contextService: SuggestionGenerationContextService,
    private readonly notifications: NotificationsService,
    private readonly observability: SuggestionObservabilityService,
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserNotificationPreference)
    private readonly preferenceRepo: Repository<UserNotificationPreference>,
  ) {}

  async generateForJob(job: SuggestionGenerationJob): Promise<void> {
    const subjects = await this.loadJobSubjects(job);
    if (!subjects) return;

    const { targetDate, targetTime, slot, user } = subjects;
    const inputs = await this.contextService.build({
      user,
      job,
      slot,
      targetDate,
      targetTime,
    });

    const output = await this.aiGenerator.generate(inputs);

    const savedInstance = await this.persist(user, job, slot, inputs, output);
    await this.recordGenerationOutcome(user.id, job.id, savedInstance, output);
    await this.dispatchSuggestionReadyNotification(
      user.id,
      slot.id,
      targetDate,
      savedInstance.id,
      job.id,
    );
  }

  private async loadJobSubjects(
    job: SuggestionGenerationJob,
  ): Promise<SuggestionJobSubjects | null> {
    const targetDate = toDateOnlyString(job.target_date);
    const targetTime = toTimeOnlyString(job.target_time);
    job.target_date = targetDate;
    job.target_time = targetTime;

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

  private async dispatchSuggestionReadyNotification(
    userId: string,
    slotId: string,
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
        },
        dedupeKey: `suggestion_ready:${targetDate}:${slotId}`,
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

  private async persist(
    user: User,
    job: SuggestionGenerationJob,
    slot: ScheduleSlot,
    inputs: SuggestionGenerationInputs,
    output: SuggestionGenerationOutput,
  ): Promise<SuggestionInstance> {
    const targetDate = toDateOnlyString(job.target_date);
    const targetTime = toTimeOnlyString(job.target_time);
    return this.dataSource.transaction(async (manager) => {
      const suggestionRepo = manager.getRepository(SuggestionInstance);
      const stepRepo = manager.getRepository(SuggestionStep);

      const activeBeforePersist = await suggestionRepo.findOne({
        where: {
          user_id: user.id,
          slot_id: slot.id,
          target_date: targetDate,
          generation_status: Not('superseded' as const),
        },
        order: { generated_at: 'DESC', created_at: 'DESC' },
      });
      const supersedesId =
        activeBeforePersist?.supersedes_id ??
        (activeBeforePersist?.generation_status === 'ready'
          ? activeBeforePersist.id
          : null);

      // Supersede any existing non-superseded instance for the same slot+date.
      await suggestionRepo
        .createQueryBuilder()
        .update()
        .set({ generation_status: 'superseded' })
        .where(
          'user_id = :userId AND slot_id = :slotId AND target_date = :targetDate AND generation_status <> :superseded',
          {
            userId: user.id,
            slotId: slot.id,
            targetDate,
            superseded: 'superseded',
          },
        )
        .execute();

      const visibleAt = buildSlotInstant(
        targetDate,
        slot.slot_time,
        resolveEffectiveTimeZone(user.time_zone, null),
      );
      const leadTimeMinutes = await this.resolveLeadTimeMinutes(user.id);
      const visibleAtMs = visibleAt.getTime() - leadTimeMinutes * 60_000;

      const instance = suggestionRepo.create({
        user_id: user.id,
        slot_id: slot.id,
        target_date: targetDate,
        target_time: targetTime,
        daypart: inputs.daypart,
        mode: output.mode,
        generation_status: 'ready',
        visible_at: new Date(visibleAtMs),
        generated_at: new Date(),
        ai_model: output.metadata.model,
        ai_prompt_version: output.metadata.promptVersion,
        ai_input_tokens: output.metadata.inputTokens,
        ai_output_tokens: output.metadata.outputTokens,
        ai_total_tokens: output.metadata.totalTokens,
        ai_estimated_cost_usd: output.metadata.estimatedCostUsd,
        ai_duration_ms: output.metadata.durationMs,
        ai_explanation: output.explanation,
        gap_recommendations: output.gapRecommendations,
        safety_flags: output.safetyFlags,
        has_reaction_signal: output.hasReactionSignal,
        simplified_for_reaction: output.simplifiedForReaction,
        supersedes_id: supersedesId,
        ai_error: null,
        ai_retry_count: job.attempt_count,
        generation_context: inputs.contextSummary,
      });
      const savedInstance = await suggestionRepo.save(instance);

      const steps = output.steps.map((step) =>
        stepRepo.create({
          suggestion_instance_id: savedInstance.id,
          step_order: step.stepOrder,
          routine_step_id: step.routineStepId,
          inventory_product_id: step.inventoryProductId,
          product_brand_snapshot: step.productBrand,
          product_name_snapshot: step.productName,
          step_label: step.stepLabel,
          custom_label: step.customLabel,
          application_method: step.applicationMethod,
          quantity: step.quantity,
          wait_after_minutes: step.waitAfterMinutes,
          explanation: step.explanation,
          provenance: step.provenance,
          chips: step.chips,
          safety_warnings: step.safetyWarnings,
        }),
      );
      await stepRepo.save(steps);

      return savedInstance;
    });
  }

  private async resolveLeadTimeMinutes(userId: string): Promise<number> {
    const prefs = await this.preferenceRepo.findOne({
      where: { user_id: userId },
    });
    return clampLeadTimeMinutes(prefs?.suggestion_lead_time_minutes ?? 120);
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
      },
    });
  }
}
