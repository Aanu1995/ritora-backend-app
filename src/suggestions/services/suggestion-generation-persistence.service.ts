import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { DEFAULT_LANGUAGE, normalizeLanguage } from '../../common/i18n/i18n';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionStep } from '../entities/suggestion-step.entity';
import {
  SuggestionGenerationStatus,
  SuggestionRequestSource,
} from '../suggestions.constants';
import {
  SuggestionGenerationInputs,
  SuggestionGenerationOutput,
} from './suggestion-ai-generator';
import {
  toHumanApplicationMethod,
  toHumanQuantity,
} from './suggestion-language';
import { buildSlotInstant, clampLeadTimeMinutes } from './suggestion-helpers';

const SUGGESTION_AI_MODEL_MAX_LENGTH = 60;
const SUGGESTION_AI_PROMPT_VERSION_MAX_LENGTH = 80;
const SUGGESTION_STEP_PRODUCT_SNAPSHOT_MAX_LENGTH = 255;
const SUGGESTION_STEP_CUSTOM_LABEL_MAX_LENGTH = 100;
const SUGGESTION_STEP_METHOD_MAX_LENGTH = 40;
const SUGGESTION_STEP_QUANTITY_MAX_LENGTH = 40;

@Injectable()
export class SuggestionGenerationPersistenceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(UserNotificationPreference)
    private readonly preferenceRepo: Repository<UserNotificationPreference>,
  ) {}

  async persistScheduled(
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
          target_time: targetTime,
          generation_status: Not(SuggestionGenerationStatus.Superseded),
        },
        order: { generated_at: 'DESC', created_at: 'DESC' },
      });
      const supersedesId =
        activeBeforePersist?.supersedes_id ??
        (activeBeforePersist?.generation_status ===
        SuggestionGenerationStatus.Ready
          ? activeBeforePersist.id
          : null);

      await suggestionRepo
        .createQueryBuilder()
        .update()
        .set({ generation_status: SuggestionGenerationStatus.Superseded })
        .where(
          [
            'user_id = :userId',
            'slot_id = :slotId',
            'target_date = :targetDate',
            'target_time = :targetTime',
            'generation_status <> :superseded',
          ].join(' AND '),
          {
            userId: user.id,
            slotId: slot.id,
            targetDate,
            targetTime,
            superseded: SuggestionGenerationStatus.Superseded,
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
        ...buildReadySuggestionFields(job, inputs, output, targetDate),
        user_id: user.id,
        slot_id: slot.id,
        target_time: targetTime,
        request_source: SuggestionRequestSource.Scheduled,
        request_id: null,
        request_context: null,
        visible_at: new Date(visibleAtMs),
        supersedes_id: supersedesId,
      });
      const savedInstance = await suggestionRepo.save(instance);

      await stepRepo.save(
        buildStepRows(stepRepo, savedInstance.id, inputs, output),
      );
      return savedInstance;
    });
  }

  async persistOnDemand(
    user: User,
    job: SuggestionGenerationJob,
    suggestion: SuggestionInstance,
    inputs: SuggestionGenerationInputs,
    output: SuggestionGenerationOutput,
  ): Promise<SuggestionInstance> {
    const targetDate = toDateOnlyString(job.target_date);
    const targetTime = toTimeOnlyString(job.target_time);

    return this.dataSource.transaction(async (manager) => {
      const suggestionRepo = manager.getRepository(SuggestionInstance);
      const stepRepo = manager.getRepository(SuggestionStep);

      await stepRepo.delete({ suggestion_instance_id: suggestion.id });
      const savedInstance = await suggestionRepo.save({
        ...suggestion,
        ...buildReadySuggestionFields(job, inputs, output, targetDate),
        user_id: user.id,
        slot_id: null,
        request_source: SuggestionRequestSource.OnDemand,
        target_time: targetTime,
        visible_at: suggestion.visible_at ?? new Date(),
      });

      await stepRepo.save(
        buildStepRows(stepRepo, savedInstance.id, inputs, output),
      );
      return savedInstance;
    });
  }

  private async resolveLeadTimeMinutes(userId: string): Promise<number> {
    const prefs = await this.preferenceRepo.findOne({
      where: { user_id: userId },
    });
    return clampLeadTimeMinutes(prefs?.suggestion_lead_time_minutes ?? 120);
  }
}

function buildReadySuggestionFields(
  job: SuggestionGenerationJob,
  inputs: SuggestionGenerationInputs,
  output: SuggestionGenerationOutput,
  targetDate: string,
): Partial<SuggestionInstance> {
  return {
    target_date: targetDate,
    daypart: inputs.daypart,
    mode: output.mode,
    generation_status: SuggestionGenerationStatus.Ready,
    generated_at: new Date(),
    ai_model: fitNullableColumnText(
      output.metadata.model,
      SUGGESTION_AI_MODEL_MAX_LENGTH,
    ),
    ai_prompt_version: fitNullableColumnText(
      output.metadata.promptVersion,
      SUGGESTION_AI_PROMPT_VERSION_MAX_LENGTH,
    ),
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
    ai_error: null,
    ai_retry_count: job.attempt_count,
    generation_context: inputs.contextSummary,
    environment_snapshot_id: inputs.environmentSnapshotId,
  };
}

function buildStepRows(
  stepRepo: Repository<SuggestionStep>,
  suggestionInstanceId: string,
  inputs: SuggestionGenerationInputs,
  output: SuggestionGenerationOutput,
): SuggestionStep[] {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  return output.steps.map((step) =>
    stepRepo.create({
      suggestion_instance_id: suggestionInstanceId,
      step_order: step.stepOrder,
      routine_step_id: step.routineStepId,
      inventory_product_id: step.inventoryProductId,
      product_brand_snapshot: fitNullableColumnText(
        step.productBrand,
        SUGGESTION_STEP_PRODUCT_SNAPSHOT_MAX_LENGTH,
      ),
      product_name_snapshot: fitNullableColumnText(
        step.productName,
        SUGGESTION_STEP_PRODUCT_SNAPSHOT_MAX_LENGTH,
      ),
      step_label: step.stepLabel,
      custom_label: fitNullableColumnText(
        step.customLabel,
        SUGGESTION_STEP_CUSTOM_LABEL_MAX_LENGTH,
      ),
      application_method: fitNullableColumnText(
        toHumanApplicationMethod(step.applicationMethod, language),
        SUGGESTION_STEP_METHOD_MAX_LENGTH,
      ),
      quantity: fitNullableColumnText(
        toHumanQuantity(step.quantity, language),
        SUGGESTION_STEP_QUANTITY_MAX_LENGTH,
      ),
      wait_after_minutes: step.waitAfterMinutes,
      explanation: step.explanation,
      routine_note_snapshot: step.routineNote,
      provenance: step.provenance,
      chips: step.chips,
      safety_warnings: step.safetyWarnings,
    }),
  );
}

function fitNullableColumnText(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}
