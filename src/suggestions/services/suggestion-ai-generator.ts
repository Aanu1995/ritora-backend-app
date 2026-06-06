import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFeatureOpenAiModel } from '../../common/utils/openai-config';
import {
  OPENAI_QUICK_SUGGESTION_REASONING_EFFORT,
  OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT,
  OpenAiReasoningEffort,
  openAiRepeatabilityRequestOptions,
} from '../../common/utils/openai-request-options';
import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  type AppLanguage,
} from '../../common/i18n/i18n';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../../shelf/shelf.types';
import { StepLabel } from '../../schedule/dto/schedule.constants';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';
import {
  SuggestionExplanationJson,
  SuggestionDaypart,
  SuggestionGapRecommendationJson,
  SuggestionMode,
  SuggestionRequestContextJson,
  SuggestionRequestSource,
  SuggestionSafetyFlagJson,
  SuggestionStepChipJson,
  SuggestionStepProvenance,
  SUGGESTION_PROMPT_VERSION,
} from '../suggestions.constants';
import {
  buildAssemblyContext,
  buildDeterministicSafetyFlags,
  computeMode,
  isAllSpecialistLocked,
  lockedStepsAreIntact,
  resolveRawStep,
  routineStepToOutput,
  sanitizeExplanation,
  sanitizeGapRecommendations,
  sanitizeSafetyFlags,
} from './suggestion-ai-assembly';
import {
  buildPrompt,
  defaultExplanation,
  estimateCost,
  extractOutputText,
  OpenAiResponsePayload,
  RawSuggestionResponse,
  RESPONSE_FORMAT,
  SYSTEM_PROMPT,
} from './suggestion-ai-contract';
import {
  buildDeterministicAiSteps,
  buildDeterministicGapRecommendations,
  deterministicExplanation,
} from './suggestion-baseline-generator';
import { hasUsableJournalReactionSignal } from './suggestion-journal-context';
import {
  hasCurrentSelectionEvidence,
  hasUnsupportedAiProductSelectionStep,
  requiresOwnedDaytimeSpf,
} from './suggestion-routine-repeat-policy';
import { resolveSuggestionProductScores } from './suggestion-product-score-resolver';
import {
  isPreferredTimeCompatibleWithDaypart,
  isStrongActiveTag,
} from './suggestion-product-intelligence';

export const SUGGESTION_AI_MODEL_ENV_KEY = 'SUGGESTION_AI_MODEL';
export const SUGGESTION_AI_TIMEOUT_MS = 180_000;
export const SUGGESTION_AI_MAX_OUTPUT_TOKENS = 24000;
const SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS = 2;

export interface SuggestionGenerationInputs {
  language?: AppLanguage;
  slotId: string | null;
  requestSource: SuggestionRequestSource;
  requestContext: SuggestionRequestContextJson | null;
  scheduledSlotContext?: {
    slotNotes: string | null;
    specialistSafetyNotes: string | null;
  } | null;
  targetDate: string;
  targetTime: string;
  daypart: SuggestionDaypart;
  skinProfile: SkinProfile | null;
  shelfActiveProducts: InventoryProduct[];
  shelfFinishedProductIds: string[];
  routineSteps: RoutineStep[];
  recentJournalEntries: SkinJournalEntry[];
  recentApplications: ApplicationLog[];
  contextSummary: SuggestionContextSummary;
  environmentSnapshotId: string | null;
  aiPersonalizationAllowed: boolean;
  aiPersonalizationBlockedReason: string | null;
}

export interface SuggestionGenerationOutput {
  mode: SuggestionMode;
  hasReactionSignal: boolean;
  simplifiedForReaction: boolean;
  explanation: SuggestionExplanationJson;
  gapRecommendations: SuggestionGapRecommendationJson[];
  safetyFlags: SuggestionSafetyFlagJson[];
  steps: SuggestionGenerationStepOutput[];
  metadata: {
    model: string;
    promptVersion: string;
    provider?: 'openai' | 'deterministic_baseline';
    fallbackReason?: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
    durationMs: number;
  };
}

export interface SuggestionGenerationStepOutput {
  stepOrder: number;
  routineStepId: string | null;
  inventoryProductId: string | null;
  productBrand: string | null;
  productName: string | null;
  stepLabel: StepLabel;
  customLabel: string | null;
  applicationMethod: string | null;
  quantity: string | null;
  waitAfterMinutes: number | null;
  explanation: string | null;
  routineNote: string | null;
  provenance: SuggestionStepProvenance;
  chips: SuggestionStepChipJson[];
  safetyWarnings: SuggestionSafetyFlagJson[];
}

@Injectable()
export class SuggestionAiGenerator {
  private readonly logger = new Logger(SuggestionAiGenerator.name);

  constructor(private readonly configService: ConfigService) {}

  async generate(
    inputs: SuggestionGenerationInputs,
  ): Promise<SuggestionGenerationOutput> {
    const startedAt = Date.now();
    const model = readFeatureOpenAiModel(
      this.configService,
      SUGGESTION_AI_MODEL_ENV_KEY,
      'gpt-4.1-mini',
    );
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();

    if (!inputs.aiPersonalizationAllowed) {
      return this.buildBaseline(
        inputs,
        startedAt,
        `deterministic-baseline:${inputs.aiPersonalizationBlockedReason ?? 'ai_disabled'}`,
        inputs.aiPersonalizationBlockedReason ?? 'ai_personalization_disabled',
      );
    }

    if (isAllSpecialistLocked(inputs)) {
      return this.buildBaseline(
        inputs,
        startedAt,
        'deterministic-baseline',
        'all_specialist_locked',
      );
    }

    if (hasNoUsableShelfOptions(inputs)) {
      return this.buildBaseline(
        inputs,
        startedAt,
        'deterministic-baseline',
        'no_usable_shelf_limited_data',
      );
    }

    if (!apiKey || !model) {
      return this.buildBaseline(
        inputs,
        startedAt,
        'deterministic-baseline',
        'missing_openai_configuration',
      );
    }

    try {
      const prompt = buildPrompt(inputs);
      const { outputText, payload } = await this.requestStructuredOutput({
        apiKey,
        model,
        prompt,
        reasoningEffort: suggestionReasoningEffort(inputs),
      });
      if (!outputText) {
        throw new Error('OpenAI returned no usable structured output.');
      }
      const usage = payload.usage ?? null;
      const rawOutput: RawSuggestionResponse = JSON.parse(
        outputText,
      ) as RawSuggestionResponse;
      return this.assembleOutput(inputs, rawOutput, {
        model,
        durationMs: Date.now() - startedAt,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
        estimatedCostUsd: usage ? estimateCost(usage) : null,
        provider: 'openai',
        fallbackReason: null,
      });
    } catch (error) {
      this.logger.warn(
        `AI suggestion generation failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }. Falling back to baseline.`,
      );
      return this.buildBaseline(
        inputs,
        startedAt,
        `fallback:${model ?? 'unknown'}`,
        'provider_failure',
      );
    }
  }

  private assembleOutput(
    inputs: SuggestionGenerationInputs,
    raw: RawSuggestionResponse,
    metadata: GenerationMetadata,
  ): SuggestionGenerationOutput {
    if (!lockedStepsAreIntact(inputs, raw.steps ?? [])) {
      this.logger.warn('AI changed a specialist-locked step. Falling back.');
      return this.buildBaseline(
        inputs,
        Date.now() - metadata.durationMs,
        metadata.model,
        'specialist_locked_step_changed',
      );
    }

    const context = buildAssemblyContext(inputs);
    const steps: SuggestionGenerationStepOutput[] = [];
    for (const [index, rawStep] of (raw.steps ?? []).entries()) {
      const resolved = resolveRawStep(rawStep, index, context);
      if (!resolved) {
        this.logger.warn('AI returned an invalid product or step reference.');
        continue;
      }
      steps.push(resolved);
    }
    if (steps.length === 0 && (raw.steps ?? []).length > 0) {
      return this.buildBaseline(
        inputs,
        Date.now() - metadata.durationMs,
        metadata.model,
        'invalid_product_or_step_reference',
      );
    }
    let repairedSteps = repairRecoverableMissingSteps(inputs, steps);
    let hardSafetyFallbackReason = resolveHardSafetyFallbackReason(
      inputs,
      repairedSteps,
    );
    if (hardSafetyFallbackReason) {
      const recoveredSteps = recoverHardSafetyViolation(
        inputs,
        repairedSteps,
        hardSafetyFallbackReason,
      );
      if (recoveredSteps) {
        repairedSteps = recoveredSteps;
        hardSafetyFallbackReason = null;
      }
    }
    if (hardSafetyFallbackReason) {
      this.logger.warn(
        `AI suggestion violated a hard safety constraint: ${hardSafetyFallbackReason}. Falling back.`,
      );
      return this.buildBaseline(
        inputs,
        Date.now() - metadata.durationMs,
        metadata.model,
        hardSafetyFallbackReason,
      );
    }
    const orderedSteps = orderGeneratedSteps(
      inputs,
      repairedSteps,
      context.lockedSteps.length > 0,
    );
    const explanation = normalizeExplanationForSelectedSteps(
      inputs,
      orderedSteps,
      sanitizeExplanation(raw.explanation ?? defaultExplanation()),
    );
    const copyFallbackReason = resolveCopyFallbackReason(
      inputs,
      orderedSteps,
      explanation,
    );
    if (copyFallbackReason) {
      this.logger.warn(
        `AI suggestion copy contradicted the steps: ${copyFallbackReason}. Falling back.`,
      );
      return this.buildBaseline(
        inputs,
        Date.now() - metadata.durationMs,
        metadata.model,
        copyFallbackReason,
      );
    }

    const hasReactionSignal = hasReactionSignalInInputs(inputs);
    const gapRecommendations = mergeRequiredDeterministicGapRecommendations(
      inputs,
      orderedSteps,
      filterContextualGapRecommendations(
        inputs,
        orderedSteps,
        sanitizeGapRecommendations(raw.gapRecommendations ?? []),
      ),
    );
    return {
      mode: computeMode(orderedSteps, context.lockedSteps.length > 0),
      hasReactionSignal,
      simplifiedForReaction:
        Boolean(raw.simplifiedForReaction) && hasReactionSignal,
      explanation,
      gapRecommendations,
      safetyFlags: [
        ...filterContextualSafetyFlags(
          inputs,
          orderedSteps,
          sanitizeSafetyFlags(raw.safetyFlags ?? []),
        ),
        ...buildDeterministicSafetyFlags(inputs, orderedSteps),
      ],
      steps: orderedSteps,
      metadata: {
        ...metadata,
        promptVersion: SUGGESTION_PROMPT_VERSION,
      },
    };
  }

  private async requestStructuredOutput(input: {
    apiKey: string;
    model: string;
    prompt: string;
    reasoningEffort: OpenAiReasoningEffort;
  }): Promise<{
    outputText: string | null;
    payload: OpenAiResponsePayload;
  }> {
    let lastPayload: OpenAiResponsePayload | null = null;
    for (
      let attempt = 1;
      attempt <= SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS;
      attempt += 1
    ) {
      const payload = await this.requestOpenAiResponse(input);
      const outputText = extractOutputText(payload);
      if (outputText) {
        return { outputText, payload };
      }
      lastPayload = payload;
    }

    return {
      outputText: null,
      payload: lastPayload ?? {},
    };
  }

  private async requestOpenAiResponse(input: {
    apiKey: string;
    model: string;
    prompt: string;
    reasoningEffort: OpenAiReasoningEffort;
  }): Promise<OpenAiResponsePayload> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        store: false,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: input.prompt }],
          },
        ],
        max_output_tokens: SUGGESTION_AI_MAX_OUTPUT_TOKENS,
        ...openAiRepeatabilityRequestOptions(
          input.model,
          input.reasoningEffort,
        ),
        text: {
          verbosity: 'low',
          format: RESPONSE_FORMAT,
        },
      }),
      signal: AbortSignal.timeout(SUGGESTION_AI_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`OpenAI suggestion call failed (${response.status}).`);
    }

    return (await response.json()) as OpenAiResponsePayload;
  }

  private buildBaseline(
    inputs: SuggestionGenerationInputs,
    startedAt: number,
    model: string,
    fallbackReason: string | null,
  ): SuggestionGenerationOutput {
    const orderedSteps = [...inputs.routineSteps].sort(
      (a, b) => a.step_order - b.step_order,
    );
    const steps =
      orderedSteps.length > 0
        ? buildManualBaselineSteps(inputs, orderedSteps, fallbackReason)
        : buildDeterministicAiSteps(inputs);
    const hasAiSupportStep = steps.some(
      (step) => step.provenance === SuggestionStepProvenance.AiAdded,
    );
    const hasReactionSignal = hasReactionSignalInInputs(inputs);
    return {
      mode:
        orderedSteps.length === 0
          ? SuggestionMode.Ai
          : computeMode(
              steps,
              orderedSteps.some((step) => step.is_specialist_locked),
            ),
      hasReactionSignal,
      simplifiedForReaction: hasReactionSignal && orderedSteps.length === 0,
      explanation:
        orderedSteps.length === 0 || hasAiSupportStep
          ? deterministicExplanation(inputs, steps)
          : defaultExplanation(),
      gapRecommendations: buildDeterministicGapRecommendations(inputs),
      safetyFlags: buildDeterministicSafetyFlags(inputs, steps),
      steps,
      metadata: {
        model,
        promptVersion: SUGGESTION_PROMPT_VERSION,
        provider: 'deterministic_baseline',
        fallbackReason,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostUsd: null,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

function suggestionReasoningEffort(
  inputs: SuggestionGenerationInputs,
): OpenAiReasoningEffort {
  return inputs.requestSource === SuggestionRequestSource.Scheduled
    ? OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT
    : OPENAI_QUICK_SUGGESTION_REASONING_EFFORT;
}

function buildManualBaselineSteps(
  inputs: SuggestionGenerationInputs,
  orderedSteps: RoutineStep[],
  fallbackReason: string | null,
): SuggestionGenerationStepOutput[] {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  const routineOutputs = orderedSteps.map((step, index) =>
    routineStepToOutput(step, index, { language }),
  );
  const productBackedRoutineOutputs = routineOutputs.filter(
    (step) => step.inventoryProductId,
  );
  const hasProductlessRoutineOutput =
    productBackedRoutineOutputs.length !== routineOutputs.length;
  if (
    hasProductlessRoutineOutput &&
    !orderedSteps.some((step) => step.is_specialist_locked)
  ) {
    const existingProductIds = new Set(
      productBackedRoutineOutputs
        .map((step) => step.inventoryProductId)
        .filter((id): id is string => Boolean(id)),
    );
    const shelfSteps = buildDeterministicAiSteps(inputs).filter(
      (step) =>
        step.inventoryProductId &&
        !existingProductIds.has(step.inventoryProductId),
    );
    if (shelfSteps.length > 0) {
      return orderBaselineSteps([
        ...productBackedRoutineOutputs,
        ...shelfSteps,
      ]);
    }
  }
  if (
    fallbackReason !== 'missing_barrier_moisturizer' ||
    orderedSteps.some((step) => step.is_specialist_locked)
  ) {
    return routineOutputs;
  }

  const existingProductIds = new Set(
    routineOutputs
      .map((step) => step.inventoryProductId)
      .filter((id): id is string => Boolean(id)),
  );
  const supportSteps = buildDeterministicAiSteps(inputs).filter(
    (step) =>
      step.stepLabel === ProductCategory.Moisturizer &&
      step.inventoryProductId &&
      !existingProductIds.has(step.inventoryProductId),
  );

  if (supportSteps.length === 0) {
    return routineOutputs;
  }
  return orderBaselineSteps([...routineOutputs, supportSteps[0]]);
}

function orderBaselineSteps(
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  const categoryOrder: StepLabel[] = [
    ProductCategory.Cleanser,
    ProductCategory.Toner,
    ProductCategory.Essence,
    ProductCategory.Serum,
    ProductCategory.Treatment,
    ProductCategory.Exfoliant,
    ProductCategory.Moisturizer,
    ProductCategory.SunProtection,
    ProductCategory.EyeCare,
    ProductCategory.LipCare,
    ProductCategory.Mask,
    ProductCategory.Other,
    'custom',
  ];
  const rank = (step: SuggestionGenerationStepOutput) => {
    const index = categoryOrder.indexOf(step.stepLabel);
    return index >= 0 ? index : categoryOrder.length;
  };
  return [...steps]
    .sort((left, right) => {
      const rankDiff = rank(left) - rank(right);
      return rankDiff || left.stepOrder - right.stepOrder;
    })
    .map((step, index) => ({ ...step, stepOrder: index }));
}

function repairRecoverableMissingSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  return repairMissingGoalSupportStep(
    inputs,
    repairMissingOnDemandMoisturizer(
      inputs,
      repairMissingOwnedDaytimeSpf(inputs, steps),
    ),
  );
}

function recoverHardSafetyViolation(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  reason: string,
): SuggestionGenerationStepOutput[] | null {
  const filtered = steps.filter(
    (step) => !shouldRemoveStepForHardSafetyRecovery(inputs, step, reason),
  );
  if (filtered.length === steps.length) return null;
  const baseSteps =
    filtered.length > 0
      ? filtered
      : buildConservativeSafetyRecoverySteps(inputs);
  if (baseSteps.length === 0) return null;
  const repaired = repairRecoverableMissingSteps(inputs, baseSteps);
  return resolveHardSafetyFallbackReason(inputs, repaired) ? null : repaired;
}

function buildConservativeSafetyRecoverySteps(
  inputs: SuggestionGenerationInputs,
): SuggestionGenerationStepOutput[] {
  const context = buildAssemblyContext(inputs);
  const preferredCategories =
    inputs.daypart === SuggestionDaypart.Evening
      ? [ProductCategory.Cleanser, ProductCategory.Moisturizer]
      : [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
  const selectedProductIds = new Set<string>();
  const steps: SuggestionGenerationStepOutput[] = [];
  const scores = resolveSuggestionProductScores(inputs)
    .filter((score) => hasCurrentSelectionEvidence(inputs, score.productId))
    .filter((score) =>
      isPreferredTimeCompatibleWithDaypart(
        score.preferredTimeOfDay,
        inputs.daypart,
      ),
    )
    .filter((score) => !hasStrongActive(score))
    .filter((score) => !hasDisqualifyingRecoveryCaution(score));

  for (const category of preferredCategories) {
    const candidate = scores
      .filter((score) => score.category === category)
      .sort((left, right) => right.suitabilityScore - left.suitabilityScore)[0];
    if (!candidate || selectedProductIds.has(candidate.productId)) continue;
    const step = resolveRawStep(
      {
        stepOrder: steps.length,
        routineStepId: null,
        inventoryProductId: candidate.productId,
        stepLabel: candidate.category,
        explanation: conservativeRecoveryExplanation(candidate.category),
        provenance: SuggestionStepProvenance.AiAdded,
      },
      steps.length,
      context,
    );
    if (!step) continue;
    selectedProductIds.add(candidate.productId);
    steps.push(step);
  }

  return orderBaselineSteps(steps);
}

function hasDisqualifyingRecoveryCaution(
  score: SuggestionContextSummary['productScores'][number],
): boolean {
  return score.cautionReasons.some((reason) =>
    /preferred time of day does not match|product may be expired|recently substituted/i.test(
      reason,
    ),
  );
}

function conservativeRecoveryExplanation(category: ProductCategory): string {
  switch (category) {
    case ProductCategory.Cleanser:
      return 'Keeps the routine gentle after removing an unsafe active.';
    case ProductCategory.Moisturizer:
      return 'Supports the barrier after removing an unsafe active.';
    case ProductCategory.SunProtection:
      return 'Keeps daytime UV protection covered.';
    default:
      return 'Fits the safer routine for this slot.';
  }
}

function shouldRemoveStepForHardSafetyRecovery(
  inputs: SuggestionGenerationInputs,
  step: SuggestionGenerationStepOutput,
  reason: string,
): boolean {
  if (
    step.provenance !== SuggestionStepProvenance.AiAdded ||
    !step.inventoryProductId
  ) {
    return false;
  }
  const score = resolveSuggestionProductScores(inputs).find(
    (productScore) => productScore.productId === step.inventoryProductId,
  );
  switch (reason) {
    case 'unsupported_product_selection':
      return !hasCurrentSelectionEvidence(inputs, step.inventoryProductId);
    case 'unsafe_daytime_strong_active':
      return score ? hasDaytimeStrongActiveConflict(inputs, score) : false;
    case 'unsafe_recent_strong_active_spacing':
    case 'unsafe_reaction_active':
    case 'unsafe_restart_active':
      return score ? hasStrongActive(score) : false;
    case 'unsafe_pregnancy_active':
      return score ? hasPregnancyCautionActive(score) : false;
    case 'preferred_time_of_day_mismatch':
      return !isPreferredTimeCompatibleWithDaypart(
        score?.preferredTimeOfDay,
        inputs.daypart,
      );
    case 'overlayered_minimal_routine':
      return score
        ? [
            ProductCategory.Serum,
            ProductCategory.Treatment,
            ProductCategory.Exfoliant,
          ].includes(score.category)
        : false;
    case 'skipped_product_returned_as_step':
      return isSkippedProductReturnedAsStep(step);
    default:
      return false;
  }
}

function repairMissingOwnedDaytimeSpf(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  if (!requiresOwnedDaytimeSpf(inputs)) return steps;
  const hasSunscreenStep = selectedProductScores(inputs, steps).some(
    (score) => score.category === ProductCategory.SunProtection,
  );
  if (hasSunscreenStep) return steps;

  const existingProductIds = new Set(
    steps
      .map((step) => step.inventoryProductId)
      .filter((productId): productId is string => Boolean(productId)),
  );
  const sunscreenStep = buildDeterministicAiSteps(inputs).find(
    (step) =>
      step.stepLabel === ProductCategory.SunProtection &&
      step.inventoryProductId &&
      !existingProductIds.has(step.inventoryProductId),
  );
  return sunscreenStep ? orderBaselineSteps([...steps, sunscreenStep]) : steps;
}

function repairMissingOnDemandMoisturizer(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  if (
    inputs.requestSource !== SuggestionRequestSource.OnDemand ||
    ![
      'post_workout',
      'post_sun',
      'post_swim',
      'post_makeup_or_shower',
    ].includes(inputs.requestContext?.intent ?? '')
  ) {
    return steps;
  }
  const selectedScores = selectedProductScores(inputs, steps);
  if (
    selectedScores.some(
      (score) => score.category === ProductCategory.Moisturizer,
    )
  ) {
    return steps;
  }
  const existingProductIds = new Set(
    steps
      .map((step) => step.inventoryProductId)
      .filter((productId): productId is string => Boolean(productId)),
  );
  const moisturizerStep = buildDeterministicAiSteps(inputs).find(
    (step) =>
      step.stepLabel === ProductCategory.Moisturizer &&
      step.inventoryProductId &&
      !existingProductIds.has(step.inventoryProductId),
  );
  return moisturizerStep
    ? orderBaselineSteps([...steps, moisturizerStep])
    : steps;
}

function repairMissingGoalSupportStep(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  if (!shouldRepairMissingGoalSupport(inputs, steps)) return steps;
  const existingProductIds = new Set(
    steps
      .map((step) => step.inventoryProductId)
      .filter((productId): productId is string => Boolean(productId)),
  );
  const candidate = resolveSuggestionProductScores(inputs)
    .filter((score) => !existingProductIds.has(score.productId))
    .filter((score) => hasCurrentSelectionEvidence(inputs, score.productId))
    .filter((score) =>
      isPreferredTimeCompatibleWithDaypart(
        score.preferredTimeOfDay,
        inputs.daypart,
      ),
    )
    .filter((score) => !hasStrongActive(score))
    .filter((score) => isGoalSupportProduct(inputs, score))
    .filter((score) => score.dataQuality !== 'insufficient')
    .sort(compareGoalSupportProducts(inputs))[0];
  if (!candidate) return steps;

  const context = buildAssemblyContext(inputs);
  const repaired = resolveRawStep(
    {
      stepOrder: steps.length,
      routineStepId: null,
      inventoryProductId: candidate.productId,
      stepLabel: candidate.category,
      explanation:
        'Supports your current skin goal without adding a strong active.',
      provenance: SuggestionStepProvenance.AiAdded,
    },
    steps.length,
    context,
  );
  if (!repaired) return steps;
  return orderBaselineSteps([...steps, repaired]);
}

function shouldRepairMissingGoalSupport(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): boolean {
  if (inputs.requestSource !== SuggestionRequestSource.Scheduled) return false;
  if (steps.length === 0 || steps.length >= 4) return false;
  if (prefersMinimalRoutine(inputs)) return false;
  if (
    inputs.contextSummary.reaction.hasSignal ||
    inputs.contextSummary.reaction.barrierCompromised ||
    inputs.contextSummary.routineBreak.recentlyResumed ||
    inputs.contextSummary.applicationPatterns.conservativeRestart
  ) {
    return false;
  }
  const selectedScores = selectedProductScores(inputs, steps);
  if (selectedScores.some((score) => isGoalSupportProduct(inputs, score))) {
    return false;
  }
  return hasGoalNeedingShelfSupport(inputs);
}

function hasGoalNeedingShelfSupport(
  inputs: SuggestionGenerationInputs,
): boolean {
  return /(acne|breakout|clogged|spot|dark mark|hyperpigmentation|uneven tone|pigment|texture|pores?)/i.test(
    goalSupportText(inputs),
  );
}

function isGoalSupportProduct(
  inputs: SuggestionGenerationInputs,
  score: SuggestionContextSummary['productScores'][number],
): boolean {
  if (
    [
      ProductCategory.Cleanser,
      ProductCategory.Moisturizer,
      ProductCategory.SunProtection,
      ProductCategory.LipCare,
    ].includes(score.category)
  ) {
    return false;
  }
  return goalSupportRank(inputs, score) > 0;
}

function compareGoalSupportProducts(inputs: SuggestionGenerationInputs) {
  return (
    left: SuggestionContextSummary['productScores'][number],
    right: SuggestionContextSummary['productScores'][number],
  ): number => {
    const rankDelta =
      goalSupportRank(inputs, right) - goalSupportRank(inputs, left);
    return rankDelta || right.suitabilityScore - left.suitabilityScore;
  };
}

function goalSupportRank(
  inputs: SuggestionGenerationInputs,
  score: SuggestionContextSummary['productScores'][number],
): number {
  const text = goalSupportText(inputs);
  const tags = score.activeTags.map((tag) => tag.toLowerCase());
  if (
    /(acne|breakout|clogged)/i.test(text) &&
    tags.some((tag) => /niacinamide|azelaic|azelaic_acid|acne|zinc/.test(tag))
  ) {
    return 4;
  }
  if (
    /(dark mark|hyperpigmentation|uneven tone|pigment|spot)/i.test(text) &&
    tags.some((tag) =>
      /niacinamide|azelaic|azelaic_acid|vitamin_c|pigment/.test(tag),
    )
  ) {
    return 4;
  }
  if (
    /(texture|pores?)/i.test(text) &&
    tags.some((tag) =>
      /niacinamide|azelaic|azelaic_acid|pha|humectant|hydrating/.test(tag),
    )
  ) {
    return 3;
  }
  return score.suitabilityReasons.some((reason) =>
    /primary selected goal|secondary selected goal/i.test(reason),
  )
    ? 2
    : 0;
}

function goalSupportText(inputs: SuggestionGenerationInputs): string {
  return JSON.stringify([
    inputs.skinProfile?.primary_goal ?? '',
    inputs.skinProfile?.current_concerns ?? [],
    inputs.contextSummary.skinProfile.primaryGoal ?? '',
    inputs.contextSummary.skinProfile.activeConcerns,
    inputs.contextSummary.goalSignals?.mainGoal ?? '',
    inputs.contextSummary.goalSignals?.primaryGoal ?? '',
    inputs.contextSummary.goalSignals?.selectedGoals ?? [],
    inputs.contextSummary.goalSignals?.secondaryGoals.map(
      (goal) => goal.concern,
    ) ?? [],
    inputs.contextSummary.journalSignals?.detectedConcerns.map(
      (concern) => concern.concern,
    ) ?? [],
  ]);
}

function orderGeneratedSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  hasLockedInput: boolean,
): SuggestionGenerationStepOutput[] {
  if (hasLockedInput || inputs.routineSteps.length > 0) {
    return [...steps].sort((left, right) => left.stepOrder - right.stepOrder);
  }
  return orderBaselineSteps(steps);
}

function normalizeExplanationForSelectedSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  explanation: SuggestionExplanationJson,
): SuggestionExplanationJson {
  const selectedProductLabels = new Set(
    steps.flatMap((step) =>
      [
        step.inventoryProductId,
        step.productName,
        step.productBrand && step.productName
          ? `${step.productBrand} ${step.productName}`
          : null,
      ]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => normalizeProductCopy(value)),
    ),
  );
  const perStepReasons = steps.map((step) => ({
    stepOrder: step.stepOrder,
    reason: step.explanation ?? 'Good fit for this slot.',
  }));
  const body = [
    ...explanation.body.filter(
      (line) =>
        !isConditionalSelectedSpfText(steps, line) &&
        !isOffSlotSunscreenCopy(inputs, line),
    ),
    ...deterministicExplanationBodyLines(inputs, explanation.body),
  ];
  const skipped = mergeSkippedExplanationItems(
    explanation.skipped.filter((skipped) => {
      const normalizedName = normalizeProductCopy(skipped.name);
      return ![...selectedProductLabels].some(
        (selected) =>
          selected.length > 0 &&
          (normalizedName.includes(selected) ||
            selected.includes(normalizedName)),
      );
    }),
    deterministicSkippedExplanationItems(inputs, selectedProductLabels),
  );

  return {
    ...explanation,
    body,
    perStepReasons,
    skipped,
    inputs: normalizeExplanationInputs(inputs, explanation.inputs),
  };
}

function normalizeExplanationInputs(
  inputs: SuggestionGenerationInputs,
  explanationInputs: SuggestionExplanationJson['inputs'],
): SuggestionExplanationJson['inputs'] {
  return explanationInputs
    .map((input) => ({
      ...input,
      detail: removeUnsupportedProfileClaims(inputs, input.detail),
    }))
    .filter((input) => input.label.trim() && input.detail.trim());
}

function removeUnsupportedProfileClaims(
  inputs: SuggestionGenerationInputs,
  detail: string,
): string {
  if (hasHighPihTendency(inputs)) return detail;
  return detail
    .replace(/,\s*high PIH tendency\b/gi, '')
    .replace(/\bhigh PIH tendency,\s*/gi, '')
    .replace(/\bhigh PIH tendency\b/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hasHighPihTendency(inputs: SuggestionGenerationInputs): boolean {
  return /high|very|strong/i.test(
    JSON.stringify([
      inputs.skinProfile?.skin_behavior?.pih_tendency ?? '',
      inputs.contextSummary.profileSignals?.skinBehavior.pihTendency ?? '',
    ]),
  );
}

function normalizeProductCopy(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function deterministicExplanationBodyLines(
  inputs: SuggestionGenerationInputs,
  existingBody: string[],
): string[] {
  const lines: string[] = [];
  const bodyText = existingBody.join(' ');
  const strongActiveLine = strongActiveSpacingBodyLine(inputs);
  if (strongActiveLine && needsStrongActiveSpacingLine(inputs, bodyText)) {
    lines.push(strongActiveLine);
  }
  if (
    hasPregnancyOrMedicationCaution(inputs) &&
    !hasMedicationProfessionalGuidance(bodyText)
  ) {
    lines.push(medicationProfessionalGuidanceLine(inputs));
  }
  return lines;
}

function needsStrongActiveSpacingLine(
  inputs: SuggestionGenerationInputs,
  bodyText: string,
): boolean {
  if (
    !/retinoid|strong active|exfoliat|\baha\b|\bbha\b|glycolic|salicylic/i.test(
      bodyText,
    )
  ) {
    return true;
  }
  return (
    Boolean(latestStrongActiveApplication(inputs)) &&
    !/\b(yesterday|recent|used|last night|\d{4}-\d{2}-\d{2})\b/i.test(bodyText)
  );
}

function strongActiveSpacingBodyLine(
  inputs: SuggestionGenerationInputs,
): string | null {
  if (
    !inputs.contextSummary.safetyConstraints.some((constraint) =>
      /space_strong_actives|avoid_new_strong_actives/i.test(constraint),
    )
  ) {
    return null;
  }
  const latestStrongActive = latestStrongActiveApplication(inputs);
  const activeLabel = skippedStrongActiveLabel(inputs);
  const slotLabel =
    inputs.daypart === SuggestionDaypart.Evening ? 'tonight' : 'today';
  if (latestStrongActive) {
    const recency = recencyCopy(
      inputs.targetDate,
      latestStrongActive.lastAppliedDate,
    );
    return `${latestStrongActive.name} was used ${recency}, so ${activeLabel} stay spaced ${slotLabel}.`;
  }
  if (inputs.contextSummary.skippedCandidates.length === 0) return null;
  return `${activeLabel} stay spaced ${slotLabel} to avoid stacking strong actives.`;
}

function skippedStrongActiveLabel(inputs: SuggestionGenerationInputs): string {
  const productScoreById = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  const tags = new Set(
    inputs.contextSummary.skippedCandidates.flatMap(
      (candidate) =>
        productScoreById.get(candidate.productId)?.activeTags ?? [],
    ),
  );
  const hasRetinoid = [...tags].some((tag) =>
    /retinoid|retinol|adapalene|tretinoin/i.test(tag),
  );
  const hasExfoliant = [...tags].some((tag) =>
    /aha|bha|glycolic|lactic|mandelic|salicylic/i.test(tag),
  );
  if (hasRetinoid && hasExfoliant) return 'retinoid and exfoliating steps';
  if (hasRetinoid) return 'retinoid steps';
  if (hasExfoliant) return 'exfoliating active steps';
  return 'strong active steps';
}

function medicationProfessionalGuidanceLine(
  inputs: SuggestionGenerationInputs,
): string {
  const professional = /yes|dermatologist|dermatology/i.test(
    inputs.skinProfile?.under_dermatologist_care ?? '',
  )
    ? 'your dermatologist'
    : 'your responsible professional';
  return `Medication context: keep retinoid or acne actives paused unless ${professional} clears them.`;
}

function hasMedicationProfessionalGuidance(value: string): boolean {
  return (
    /\b(medication|medicin|medicine|medicacion|pregnan|gravid|embarazo|breastfeed)\b/i.test(
      value,
    ) &&
    /\b(professional|dermatologist|clinician|doctor|specialist|clears|guidance)\b/i.test(
      value,
    )
  );
}

function latestStrongActiveApplication(inputs: SuggestionGenerationInputs): {
  name: string;
  lastAppliedDate: string;
} | null {
  const scoreByProductId = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  const strongApplications =
    inputs.contextSummary.appliedProductHistory?.products
      .filter(
        (product) =>
          product.productId &&
          product.lastAppliedDate &&
          scoreByProductId
            .get(product.productId)
            ?.activeTags.some(isStrongActiveTag),
      )
      .sort((left, right) =>
        (right.lastAppliedDate ?? '').localeCompare(left.lastAppliedDate ?? ''),
      ) ?? [];
  const latest = strongApplications[0];
  if (!latest?.productId || !latest.lastAppliedDate) return null;
  const score = scoreByProductId.get(latest.productId);
  return {
    name:
      [latest.brand, latest.name].filter(Boolean).join(' ') ||
      score?.name ||
      latest.productId,
    lastAppliedDate: latest.lastAppliedDate,
  };
}

function recencyCopy(targetDate: string, appliedDate: string): string {
  const days = daysBetweenDates(appliedDate, targetDate);
  if (days === 1) return 'yesterday';
  if (days > 1 && days <= 7) return `${days} days ago`;
  return 'recently';
}

function daysBetweenDates(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function deterministicSkippedExplanationItems(
  inputs: SuggestionGenerationInputs,
  selectedProductLabels: Set<string>,
): SuggestionExplanationJson['skipped'] {
  const productScoreById = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  const shelfProductById = new Map(
    inputs.shelfActiveProducts.map((product) => [product.id, product]),
  );
  return inputs.contextSummary.skippedCandidates.flatMap((candidate) => {
    const score = productScoreById.get(candidate.productId);
    const shelfProduct = shelfProductById.get(candidate.productId);
    const name = score
      ? [shelfProduct?.brand ?? score.brand, shelfProduct?.name ?? score.name]
          .filter(Boolean)
          .join(' ')
      : candidate.productId;
    const normalizedName = normalizeProductCopy(name);
    if (
      [...selectedProductLabels].some(
        (selected) =>
          selected.length > 0 &&
          (normalizedName.includes(selected) ||
            selected.includes(normalizedName)),
      )
    ) {
      return [];
    }
    return [
      {
        name,
        reason: skippedStrongActiveReason(inputs),
      },
    ];
  });
}

function skippedStrongActiveReason(inputs: SuggestionGenerationInputs): string {
  if (hasPregnancyOrMedicationCaution(inputs)) {
    return 'Paused for medication or professional-guidance safety.';
  }
  if (latestStrongActiveApplication(inputs)) {
    return 'Paused to space strong actives after recent use.';
  }
  return 'Paused to avoid stacking strong actives tonight.';
}

function mergeSkippedExplanationItems(
  existing: SuggestionExplanationJson['skipped'],
  additions: SuggestionExplanationJson['skipped'],
): SuggestionExplanationJson['skipped'] {
  const names = new Set(
    existing.map((item) => normalizeProductCopy(item.name)),
  );
  return [
    ...existing,
    ...additions.filter((item) => {
      const key = normalizeProductCopy(item.name);
      if (names.has(key)) return false;
      names.add(key);
      return true;
    }),
  ];
}

function hasReactionSignalInInputs(
  inputs: SuggestionGenerationInputs,
): boolean {
  return (
    inputs.contextSummary.reaction.hasSignal ||
    inputs.contextSummary.reaction.barrierCompromised ||
    inputs.recentJournalEntries.some(hasUsableJournalReactionSignal)
  );
}

function hasNoUsableShelfOptions(inputs: SuggestionGenerationInputs): boolean {
  return (
    inputs.routineSteps.length === 0 && inputs.shelfActiveProducts.length === 0
  );
}

type GenerationMetadata = Omit<
  SuggestionGenerationOutput['metadata'],
  'promptVersion'
>;

function resolveHardSafetyFallbackReason(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): string | null {
  if (steps.some(isSkippedProductReturnedAsStep)) {
    return 'skipped_product_returned_as_step';
  }
  const selectedScores = selectedProductScores(inputs, steps);
  if (
    hasPregnancyOrMedicationCaution(inputs) &&
    selectedScores.some(hasPregnancyCautionActive)
  ) {
    return 'unsafe_pregnancy_active';
  }
  if (
    hasReactionSignalInInputs(inputs) &&
    selectedScores.some(hasStrongActive)
  ) {
    return 'unsafe_reaction_active';
  }
  if (
    (inputs.contextSummary.routineBreak.recentlyResumed ||
      inputs.contextSummary.applicationPatterns.conservativeRestart) &&
    selectedScores.some(hasStrongActive)
  ) {
    return 'unsafe_restart_active';
  }
  if (
    requiresOwnedDaytimeSpf(inputs) &&
    !selectedScores.some(
      (score) => score.category === ProductCategory.SunProtection,
    )
  ) {
    return 'missing_required_daytime_spf';
  }
  if (
    requiresOwnedDaytimeSpf(inputs) &&
    steps.some((step) => isConditionalSpfStep(inputs, step))
  ) {
    return 'conditional_required_daytime_spf';
  }
  if (
    selectedScores.some((score) =>
      hasDaytimeStrongActiveConflict(inputs, score),
    )
  ) {
    return 'unsafe_daytime_strong_active';
  }
  if (
    requiresRecentStrongActiveSpacing(inputs) &&
    selectedScores.some(hasStrongActive)
  ) {
    return 'unsafe_recent_strong_active_spacing';
  }
  if (hasAiAddedPreferredTimeMismatch(inputs, steps)) {
    return 'preferred_time_of_day_mismatch';
  }
  if (
    requiresBarrierMoisturizer(inputs) &&
    !selectedScores.some(
      (score) => score.category === ProductCategory.Moisturizer,
    )
  ) {
    return 'missing_barrier_moisturizer';
  }
  if (
    prefersMinimalRoutine(inputs) &&
    selectedScores.some((score) =>
      [
        ProductCategory.Serum,
        ProductCategory.Treatment,
        ProductCategory.Exfoliant,
      ].includes(score.category),
    )
  ) {
    return 'overlayered_minimal_routine';
  }
  if (hasUnsupportedAiProductSelectionStep(inputs, steps)) {
    return 'unsupported_product_selection';
  }
  return null;
}

function hasDaytimeStrongActiveConflict(
  inputs: SuggestionGenerationInputs,
  score: SuggestionContextSummary['productScores'][number],
): boolean {
  if (inputs.daypart === SuggestionDaypart.Evening || !hasStrongActive(score)) {
    return false;
  }
  if (
    score.activeTags.some((tag) =>
      ['retinoid', 'retinol', 'adapalene', 'tretinoin'].includes(
        tag.toLowerCase(),
      ),
    )
  ) {
    return true;
  }
  return /(space_strong_actives|photosensit|very_high|high_uv|daytime|sun)/i.test(
    JSON.stringify([
      score.cautionReasons,
      inputs.contextSummary.safetyConstraints,
      inputs.contextSummary.environment?.uvRisk ?? '',
    ]),
  );
}

function selectedProductScores(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionContextSummary['productScores'] {
  const scoreByProductId = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  return steps
    .filter(
      (step) => step.provenance !== SuggestionStepProvenance.SpecialistLocked,
    )
    .map((step) =>
      step.inventoryProductId
        ? scoreByProductId.get(step.inventoryProductId)
        : null,
    )
    .filter(
      (score): score is SuggestionContextSummary['productScores'][number] =>
        Boolean(score),
    );
}

function requiresRecentStrongActiveSpacing(
  inputs: SuggestionGenerationInputs,
): boolean {
  if (
    !inputs.contextSummary.safetyConstraints.some((constraint) =>
      /space_strong_actives|avoid_new_strong_actives/i.test(constraint),
    )
  ) {
    return false;
  }
  const latestStrongActive = latestStrongActiveApplication(inputs);
  if (!latestStrongActive) return false;
  return (
    daysBetweenDates(latestStrongActive.lastAppliedDate, inputs.targetDate) <= 1
  );
}

function hasAiAddedPreferredTimeMismatch(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): boolean {
  const scoreByProductId = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  return steps.some((step) => {
    if (
      step.provenance !== SuggestionStepProvenance.AiAdded ||
      !step.inventoryProductId
    ) {
      return false;
    }
    const score = scoreByProductId.get(step.inventoryProductId);
    return !isPreferredTimeCompatibleWithDaypart(
      score?.preferredTimeOfDay,
      inputs.daypart,
    );
  });
}

function isSkippedProductReturnedAsStep(
  step: SuggestionGenerationStepOutput,
): boolean {
  if (!step.inventoryProductId) return false;
  return /\b(skip|skipped|delay|not use|not now|avoid using|save for another|use later|keep (this|it) for (later|tonight|tomorrow|evening|another))\b/i.test(
    `${step.explanation ?? ''} ${step.routineNote ?? ''}`,
  );
}

function hasPregnancyOrMedicationCaution(
  inputs: SuggestionGenerationInputs,
): boolean {
  const safetyValues = Object.values(inputs.skinProfile?.safety_context ?? {});
  const text = JSON.stringify([
    inputs.skinProfile?.pregnancy_status ?? '',
    safetyValues,
    inputs.skinProfile?.under_dermatologist_care ?? '',
  ]).toLowerCase();
  return /(pregnan|breastfeed|trying|conceiv|medication)/i.test(text);
}

function hasPregnancyCautionActive(score: { activeTags: string[] }): boolean {
  return score.activeTags.some((tag) =>
    ['retinoid', 'retinol', 'adapalene', 'tretinoin'].includes(
      tag.toLowerCase(),
    ),
  );
}

function hasStrongActive(score: { activeTags: string[] }): boolean {
  return score.activeTags.some((tag) =>
    [
      'retinoid',
      'retinol',
      'adapalene',
      'tretinoin',
      'aha',
      'bha',
      'glycolic',
      'lactic',
      'mandelic',
      'salicylic',
      'benzoyl_peroxide',
    ].includes(tag.toLowerCase()),
  );
}

function resolveCopyFallbackReason(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  explanation: SuggestionExplanationJson,
): string | null {
  if (
    inputs.shelfActiveProducts.length === 0 &&
    steps.length === 0 &&
    (explanation.perStepReasons.length > 0 ||
      /\bstep\b/i.test(`${explanation.headline} ${explanation.body.join(' ')}`))
  ) {
    return 'no_shelf_gap_only_copy';
  }
  if (
    hasPregnancyOrMedicationCaution(inputs) &&
    !hasMedicationCautionMainGuidance(explanation)
  ) {
    return 'missing_medication_caution_copy';
  }
  if (
    steps.length > 1 &&
    explanation.body.some((line) => /\bonly\b/i.test(line))
  ) {
    return 'contradictory_only_copy';
  }
  return null;
}

function hasMedicationCautionMainGuidance(
  explanation: SuggestionExplanationJson,
): boolean {
  return /\b(medication|medicacion|medicin|medicine|pregnan|embarazo|gravid|breastfeed|clinician|clinica|klinisk|specialist|doctor|prescrib)\b/i.test(
    explanation.body.join(' '),
  );
}

function isConditionalSpfStep(
  inputs: SuggestionGenerationInputs,
  step: SuggestionGenerationStepOutput,
): boolean {
  const score = step.inventoryProductId
    ? resolveSuggestionProductScores(inputs).find(
        (product) => product.productId === step.inventoryProductId,
      )
    : null;
  if (score?.category !== ProductCategory.SunProtection) return false;
  return /\b(if|when)\b.{0,48}\b(outside|daylight|sun|heading back|going back)\b/i.test(
    `${step.explanation ?? ''} ${step.routineNote ?? ''}`,
  );
}

function requiresBarrierMoisturizer(
  inputs: SuggestionGenerationInputs,
): boolean {
  const hasMoisturizer = resolveSuggestionProductScores(inputs).some(
    (score) => score.category === ProductCategory.Moisturizer,
  );
  if (!hasMoisturizer) return false;
  return /(dry|dryness|flaking|barrier|reaction|stinging|cold|very_dry|restart)/i.test(
    JSON.stringify([
      inputs.skinProfile?.primary_goal ?? '',
      inputs.skinProfile?.current_concerns ?? [],
      inputs.contextSummary.skinProfile.activeConcerns,
      inputs.contextSummary.reaction.indicators,
      inputs.contextSummary.safetyConstraints,
      inputs.contextSummary.environment?.humidityBand ?? '',
      inputs.contextSummary.routineBreak.recentlyResumed ? 'restart' : '',
    ]),
  );
}

function prefersMinimalRoutine(inputs: SuggestionGenerationInputs): boolean {
  const preferences = inputs.skinProfile?.routine_preferences;
  if (preferences?.pace === 'minimal') return true;
  if (
    inputs.daypart === SuggestionDaypart.Morning &&
    typeof preferences?.am_minutes === 'number' &&
    preferences.am_minutes <= 5
  ) {
    return true;
  }
  if (
    inputs.daypart === SuggestionDaypart.Evening &&
    typeof preferences?.pm_minutes === 'number' &&
    preferences.pm_minutes <= 5
  ) {
    return true;
  }
  return false;
}

function filterContextualGapRecommendations(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  gaps: SuggestionGapRecommendationJson[],
): SuggestionGapRecommendationJson[] {
  const selectedScores = selectedProductScores(inputs, steps);
  const selectedPhotosensitizingActive = selectedScores.some(hasStrongActive);
  const selectedSunscreen = selectedScores.some(
    (score) => score.category === ProductCategory.SunProtection,
  );
  const selectedMoisturizer = selectedScores.some(
    (score) => score.category === ProductCategory.Moisturizer,
  );
  return gaps.filter((gap) => {
    if (isOwnedProductGap(inputs, gap)) return false;
    if (!isEssentialTodayGap(gap)) return false;
    if (
      hasReactionSignalInInputs(inputs) &&
      !isSunscreenGap(gap) &&
      !isMoisturizerGap(gap)
    ) {
      return false;
    }
    if (selectedSunscreen && isSunscreenGap(gap)) return false;
    if (selectedMoisturizer && isMoisturizerGap(gap)) return false;
    if (!isSunscreenGap(gap)) return true;
    if (inputs.daypart !== SuggestionDaypart.Evening) return true;
    if (selectedPhotosensitizingActive) return true;
    if (needsPigmentOrUvProtection(inputs)) return true;
    return false;
  });
}

function isEssentialTodayGap(gap: SuggestionGapRecommendationJson): boolean {
  return isSunscreenGap(gap) || isMoisturizerGap(gap);
}

function mergeRequiredDeterministicGapRecommendations(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  gaps: SuggestionGapRecommendationJson[],
): SuggestionGapRecommendationJson[] {
  const deterministicGaps = filterContextualGapRecommendations(
    inputs,
    steps,
    buildDeterministicGapRecommendations(inputs),
  );
  const merged = [...gaps];
  for (const deterministicGap of deterministicGaps) {
    if (merged.some((gap) => equivalentGap(gap, deterministicGap))) continue;
    merged.push(deterministicGap);
  }
  return merged;
}

function equivalentGap(
  left: SuggestionGapRecommendationJson,
  right: SuggestionGapRecommendationJson,
): boolean {
  if (isSunscreenGap(left) && isSunscreenGap(right)) return true;
  const leftText = normalizeProductCopy(
    `${left.ingredientOrCategory} ${left.reason} ${left.goalAlignment ?? ''}`,
  );
  const rightCategory = normalizeProductCopy(right.ingredientOrCategory);
  return leftText.includes(rightCategory);
}

function filterContextualSafetyFlags(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  flags: SuggestionSafetyFlagJson[],
): SuggestionSafetyFlagJson[] {
  return flags.filter(
    (flag) =>
      !isConditionalSelectedSpfText(steps, flag.message) &&
      !isOffSlotSunscreenCopy(inputs, flag.message),
  );
}

function isOwnedProductGap(
  inputs: SuggestionGenerationInputs,
  gap: SuggestionGapRecommendationJson,
): boolean {
  const text = `${gap.ingredientOrCategory} ${gap.reason} ${
    gap.goalAlignment ?? ''
  }`.toLowerCase();
  return resolveSuggestionProductScores(inputs).some((score) => {
    const productName = score.name.toLowerCase();
    if (productName && text.includes(productName)) return true;
    if (text.includes(score.productId.toLowerCase())) return true;
    if (
      score.category === ProductCategory.Exfoliant ||
      score.category === ProductCategory.Treatment
    ) {
      return score.activeTags.some((tag) => text.includes(tag.toLowerCase()));
    }
    return false;
  });
}

function isSunscreenGap(gap: SuggestionGapRecommendationJson): boolean {
  return /spf|sunscreen|sun protection/i.test(
    `${gap.ingredientOrCategory} ${gap.reason} ${gap.goalAlignment ?? ''}`,
  );
}

function isMoisturizerGap(gap: SuggestionGapRecommendationJson): boolean {
  return /moisturizer|moisturiser|barrier|cream|hydrating/i.test(
    `${gap.ingredientOrCategory} ${gap.reason} ${gap.goalAlignment ?? ''}`,
  );
}

function isConditionalSelectedSpfText(
  steps: SuggestionGenerationStepOutput[],
  value: string,
): boolean {
  const hasSelectedSunscreen = steps.some(
    (step) => step.stepLabel === ProductCategory.SunProtection,
  );
  if (!hasSelectedSunscreen) return false;
  return (
    /\b(spf|sunscreen|sun protection)\b/i.test(value) &&
    /\b(if|when|outside|sunlight|heading back|going back|good add|useful if)\b/i.test(
      value,
    )
  );
}

function isOffSlotSunscreenCopy(
  inputs: SuggestionGenerationInputs,
  value: string,
): boolean {
  if (inputs.daypart !== SuggestionDaypart.Evening) return false;
  if (requiresOwnedDaytimeSpf(inputs)) return false;
  return /\b(spf|sunscreen|sun protection)\b/i.test(value);
}

function needsPigmentOrUvProtection(
  inputs: SuggestionGenerationInputs,
): boolean {
  return /(dark mark|hyperpigmentation|uneven tone|melasma|pigment|uv|sun)/i.test(
    JSON.stringify([
      inputs.skinProfile?.primary_goal ?? '',
      inputs.skinProfile?.current_concerns ?? [],
      inputs.contextSummary.skinProfile.activeConcerns,
      inputs.contextSummary.safetyConstraints,
    ]),
  );
}
