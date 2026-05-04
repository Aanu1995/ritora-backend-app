import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { ShelfStatus } from '../../shelf/shelf.types';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { User } from '../../users/entities/user.entity';
import { UserDataAccessLogService } from '../../users/user-data-access-log.service';
import {
  SENSITIVE_SKIN_PROFILE_CONSENT_TYPES,
  UserDataAccessActorType,
  UserDataAccessPurpose,
} from '../../users/user-consent.constants';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionStep } from '../entities/suggestion-step.entity';
import {
  SuggestionAiGenerator,
  SuggestionGenerationInputs,
  SuggestionGenerationOutput,
} from './suggestion-ai-generator';
import { SuggestionContextBuilder } from './suggestion-context-builder.service';
import {
  buildSlotInstant,
  clampLeadTimeMinutes,
  deriveSuggestionDaypart,
} from './suggestion-helpers';

/**
 * Orchestrates one full generation cycle for a single (user, slot, date)
 * job:
 *   1. Reads the inputs the AI needs (profile, shelf, scheduled steps,
 *      recent journal entries, recent applications).
 *   2. Calls SuggestionAiGenerator to produce a routine.
 *   3. Persists the resulting SuggestionInstance + SuggestionSteps.
 *   4. Dispatches a `suggestion_ready` notification (honoured per the
 *      user's notification preferences).
 *
 * The actual claim/retry/lock semantics live in the worker.
 */
@Injectable()
export class SuggestionGenerationService {
  private readonly logger = new Logger(SuggestionGenerationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly aiGenerator: SuggestionAiGenerator,
    private readonly contextBuilder: SuggestionContextBuilder,
    private readonly notifications: NotificationsService,
    private readonly dataAccessLog: UserDataAccessLogService,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(SuggestionStep)
    private readonly suggestionStepRepo: Repository<SuggestionStep>,
    @InjectRepository(SuggestionGenerationJob)
    private readonly jobRepo: Repository<SuggestionGenerationJob>,
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
    @InjectRepository(RoutineStep)
    private readonly routineStepRepo: Repository<RoutineStep>,
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepo: Repository<InventoryProduct>,
    @InjectRepository(SkinJournalEntry)
    private readonly journalRepo: Repository<SkinJournalEntry>,
    @InjectRepository(SkinProfile)
    private readonly skinProfileRepo: Repository<SkinProfile>,
    @InjectRepository(ApplicationLog)
    private readonly applicationLogRepo: Repository<ApplicationLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserNotificationPreference)
    private readonly preferenceRepo: Repository<UserNotificationPreference>,
  ) {}

  async generateForJob(job: SuggestionGenerationJob): Promise<void> {
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
      return;
    }
    const user = await this.userRepo.findOne({ where: { id: job.user_id } });
    if (!user) {
      this.logger.warn(`User ${job.user_id} not found for job ${job.id}`);
      return;
    }

    const profile = await this.skinProfileRepo.findOne({
      where: { user_id: user.id },
    });
    const activeProducts = await this.inventoryRepo.find({
      where: { user_id: user.id, status: ShelfStatus.Active },
    });
    const finishedProducts = await this.inventoryRepo.find({
      where: { user_id: user.id, status: ShelfStatus.FinishedUp },
      select: ['id'],
    });
    const recentJournal = await this.journalRepo.find({
      where: { user_id: user.id },
      order: { entry_date: 'DESC' },
      take: 7,
    });
    const recentApplications = await this.applicationLogRepo.find({
      where: { user_id: user.id },
      relations: ['items'],
      order: { target_date: 'DESC' },
      take: 30,
    });
    await this.recordRecommendationDataAccess(user.id);
    const daypart = deriveSuggestionDaypart(slot.slot_time);
    const contextSummary = await this.contextBuilder.build({
      userId: user.id,
      targetDate,
      targetTime,
      daypart,
      skinProfile: profile,
      shelfActiveProducts: activeProducts,
      routineSteps: slot.steps ?? [],
      recentJournalEntries: recentJournal,
      recentApplications,
    });

    const inputs: SuggestionGenerationInputs = {
      slotId: slot.id,
      targetDate,
      targetTime,
      daypart,
      skinProfile: profile,
      shelfActiveProducts: activeProducts,
      shelfFinishedProductIds: finishedProducts.map((p) => p.id),
      routineSteps: slot.steps ?? [],
      recentJournalEntries: recentJournal,
      recentApplications,
      contextSummary,
    };

    const output = await this.aiGenerator.generate(inputs);

    await this.persist(user, job, slot, inputs, output);

    // Fire suggestion_ready notification.
    try {
      await this.notifications.dispatch({
        userId: user.id,
        kind: 'suggestion_ready',
        titleKey: 'notificationsPage.kinds.suggestion_ready.title',
        bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
        deepLink: '/todays-suggestion',
        payload: {
          slotId: slot.id,
          targetDate,
        },
        dedupeKey: `suggestion_ready:${targetDate}:${slot.id}`,
      });
    } catch (error) {
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

  private async recordRecommendationDataAccess(userId: string): Promise<void> {
    await this.dataAccessLog.recordDataAccess(
      userId,
      [...SENSITIVE_SKIN_PROFILE_CONSENT_TYPES],
      UserDataAccessPurpose.RecommendationAnalysis,
      UserDataAccessActorType.System,
    );
  }
}
