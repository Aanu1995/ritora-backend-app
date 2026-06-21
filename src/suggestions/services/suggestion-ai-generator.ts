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
import {
  isDryHumidity,
  isHighUvRisk,
} from '../../environment-intelligence/environment-adaptation-policy';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  ProductCategory,
  ProductIntroductionStatus,
} from '../../shelf/shelf.types';
import { isProductIntroductionEligibleForSuggestions } from '../../shelf/product-introduction.policy';
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
  isRoutineStepEligibleForSuggestions,
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
  buildDeterministicAiStepForCategory,
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
  isSingleUseSuggestionCategory,
  isStrongActiveTag,
} from './suggestion-product-intelligence';
import { isBlockingSkippedCandidateReason } from './suggestion-safety-policy';

export const SUGGESTION_AI_MODEL_ENV_KEY = 'SUGGESTION_AI_MODEL';
export const SUGGESTION_AI_TODAYS_TIMEOUT_MS = 480_000;
export const SUGGESTION_AI_QUICK_TIMEOUT_MS = 180_000;
export const SUGGESTION_AI_TIMEOUT_MS = SUGGESTION_AI_TODAYS_TIMEOUT_MS;
export const SUGGESTION_AI_MAX_OUTPUT_TOKENS = 24000;
const SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS = 2;
const SUGGESTION_AI_TODAYS_PROVIDER_FAILURE_ATTEMPTS = 2;
const SUGGESTION_AI_QUICK_PROVIDER_FAILURE_ATTEMPTS = 1;
const SUGGESTION_AI_MIN_RETRY_TIMEOUT_MS = 1_000;

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
        timeoutMs: suggestionTimeoutMs(inputs),
        providerFailureAttempts: suggestionProviderFailureAttempts(inputs),
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
    let repairedSteps = repairSingleUseCategoryDuplicates(
      inputs,
      repairRecoverableMissingSteps(inputs, steps),
    );
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
        repairedSteps = repairSingleUseCategoryDuplicates(
          inputs,
          recoveredSteps,
        );
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
    let orderedSteps = orderGeneratedSteps(
      inputs,
      repairedSteps,
      context.lockedSteps.length > 0,
    );
    orderedSteps = sanitizeStepExplanationsForSelectedSteps(
      inputs,
      orderedSteps,
    );
    let explanation = normalizeExplanationForSelectedSteps(
      inputs,
      orderedSteps,
      sanitizeExplanation(raw.explanation ?? defaultExplanation()),
    );
    let copyFallbackReason = resolveCopyFallbackReason(
      inputs,
      orderedSteps,
      explanation,
    );
    if (copyFallbackReason === 'contradictory_only_copy') {
      explanation = repairContradictoryOnlyCopy(explanation);
      copyFallbackReason = resolveCopyFallbackReason(
        inputs,
        orderedSteps,
        explanation,
      );
    }
    if (copyFallbackReason === 'missing_medication_caution_copy') {
      explanation = repairMissingMedicationCautionCopy(inputs, explanation);
      copyFallbackReason = resolveCopyFallbackReason(
        inputs,
        orderedSteps,
        explanation,
      );
    }
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
    timeoutMs: number;
    providerFailureAttempts: number;
  }): Promise<{
    outputText: string | null;
    payload: OpenAiResponsePayload;
  }> {
    const startedAt = Date.now();
    let lastPayload: OpenAiResponsePayload | null = null;
    for (
      let attempt = 1;
      attempt <= SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS;
      attempt += 1
    ) {
      const payload = await this.requestOpenAiResponseWithRetry({
        ...input,
        startedAt,
      });
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

  private async requestOpenAiResponseWithRetry(input: {
    apiKey: string;
    model: string;
    prompt: string;
    reasoningEffort: OpenAiReasoningEffort;
    timeoutMs: number;
    providerFailureAttempts: number;
    startedAt: number;
  }): Promise<OpenAiResponsePayload> {
    for (
      let attempt = 1;
      attempt <= input.providerFailureAttempts;
      attempt += 1
    ) {
      try {
        return await this.requestOpenAiResponse({
          ...input,
          timeoutMs: remainingOpenAiTimeoutMs(input.timeoutMs, input.startedAt),
        });
      } catch (error) {
        if (
          attempt >= input.providerFailureAttempts ||
          remainingOpenAiTimeoutMs(input.timeoutMs, input.startedAt) <=
            SUGGESTION_AI_MIN_RETRY_TIMEOUT_MS
        ) {
          throw error;
        }
        this.logger.warn(
          `AI suggestion provider attempt ${attempt} failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }. Retrying within the remaining timeout budget.`,
        );
      }
    }
    throw new Error('OpenAI suggestion retry attempts exhausted.');
  }

  private async requestOpenAiResponse(input: {
    apiKey: string;
    model: string;
    prompt: string;
    reasoningEffort: OpenAiReasoningEffort;
    timeoutMs: number;
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
      signal: AbortSignal.timeout(input.timeoutMs),
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
        orderedSteps.length === 0 || steps.length === 0 || hasAiSupportStep
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

function suggestionTimeoutMs(inputs: SuggestionGenerationInputs): number {
  return inputs.requestSource === SuggestionRequestSource.Scheduled
    ? SUGGESTION_AI_TODAYS_TIMEOUT_MS
    : SUGGESTION_AI_QUICK_TIMEOUT_MS;
}

function suggestionProviderFailureAttempts(
  inputs: SuggestionGenerationInputs,
): number {
  return inputs.requestSource === SuggestionRequestSource.Scheduled
    ? SUGGESTION_AI_TODAYS_PROVIDER_FAILURE_ATTEMPTS
    : SUGGESTION_AI_QUICK_PROVIDER_FAILURE_ATTEMPTS;
}

function remainingOpenAiTimeoutMs(totalTimeoutMs: number, startedAt: number) {
  const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    throw new Error('OpenAI suggestion timeout budget exhausted.');
  }
  return remainingMs;
}

function buildManualBaselineSteps(
  inputs: SuggestionGenerationInputs,
  orderedSteps: RoutineStep[],
  fallbackReason: string | null,
): SuggestionGenerationStepOutput[] {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  const eligibleOrderedSteps = orderedSteps.filter((step) =>
    isRoutineStepEligibleForSuggestions(inputs, step),
  );
  const hasEligibleSpecialistLockedStep = eligibleOrderedSteps.some(
    (step) => step.is_specialist_locked,
  );
  const routineOutputs = eligibleOrderedSteps.map((step, index) =>
    routineStepToOutput(step, index, { language }),
  );
  if (routineOutputs.length === 0 && !hasEligibleSpecialistLockedStep) {
    return buildDeterministicAiSteps(inputs);
  }
  const productBackedRoutineOutputs = routineOutputs.filter(
    (step) => step.inventoryProductId,
  );
  const hasProductlessRoutineOutput =
    productBackedRoutineOutputs.length !== routineOutputs.length;
  if (
    hasProductlessRoutineOutput &&
    !eligibleOrderedSteps.some((step) => step.is_specialist_locked)
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
    eligibleOrderedSteps.some((step) => step.is_specialist_locked)
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
  return repairMissingEligibleManualRoutineSteps(
    inputs,
    repairThinScheduledMorningSupport(
      inputs,
      repairMissingMinimalRoutineSupport(
        inputs,
        repairMissingBarrierMoisturizer(
          inputs,
          repairMissingOnDemandMoisturizer(
            inputs,
            repairConflictingLowerScoredAiSelection(
              inputs,
              repairMissingOwnedDaytimeSpf(inputs, steps),
            ),
          ),
        ),
      ),
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
    case 'blocked_product_introduction_status':
      return !inputs.shelfActiveProducts
        .filter((product) => product.id === step.inventoryProductId)
        .every((product) =>
          isProductIntroductionEligibleForSuggestions(
            product.introduction_status,
          ),
        );
    case 'unsupported_product_selection':
      return !hasCurrentSelectionEvidence(inputs, step.inventoryProductId);
    case 'unsafe_daytime_strong_active':
      return score ? hasDaytimeStrongActiveConflict(inputs, score) : false;
    case 'unsafe_recent_strong_active_spacing':
    case 'unsafe_medication_strong_active':
    case 'unsafe_reaction_active':
    case 'unsafe_restart_active':
    case 'unsafe_dry_barrier_active':
      return score ? hasStrongActive(score) : false;
    case 'unsafe_sensitive_history_active':
      return score
        ? hasSensitiveReactiveHistoryStrongActiveCaution(inputs, score)
        : false;
    case 'unsafe_pregnancy_active':
      return score ? hasPregnancyCautionActive(score) : false;
    case 'preferred_time_of_day_mismatch':
      return !isPreferredTimeCompatibleWithDaypart(
        score?.preferredTimeOfDay,
        inputs.daypart,
      );
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
  const sunscreenStep = buildDeterministicAiStepForCategory(
    inputs,
    ProductCategory.SunProtection,
    existingProductIds,
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
  const moisturizerStep = buildDeterministicAiStepForCategory(
    inputs,
    ProductCategory.Moisturizer,
    existingProductIds,
  );
  return moisturizerStep
    ? orderBaselineSteps([...steps, moisturizerStep])
    : steps;
}

function repairMissingBarrierMoisturizer(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  if (!requiresBarrierMoisturizer(inputs)) return steps;
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
  const moisturizerStep = buildDeterministicAiStepForCategory(
    inputs,
    ProductCategory.Moisturizer,
    existingProductIds,
  );
  return moisturizerStep
    ? orderBaselineSteps([...steps, moisturizerStep])
    : steps;
}

const CONFLICT_REPLACEMENT_SCORE_MARGIN = 8;
const PRODUCT_CATEGORY_VALUES = new Set<string>(Object.values(ProductCategory));

function repairSingleUseCategoryDuplicates(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  const scoreByProductId = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  const stepsBySingleUseCategory = new Map<
    ProductCategory,
    SuggestionGenerationStepOutput[]
  >();
  for (const step of steps) {
    const category = singleUseCategoryForStep(step);
    if (!category) continue;
    stepsBySingleUseCategory.set(category, [
      ...(stepsBySingleUseCategory.get(category) ?? []),
      step,
    ]);
  }

  const keptSteps = new Set(steps);
  let changed = false;
  for (const categorySteps of stepsBySingleUseCategory.values()) {
    if (categorySteps.length <= 1) continue;
    const lockedSteps = categorySteps.filter(
      (step) => step.provenance === SuggestionStepProvenance.SpecialistLocked,
    );
    if (lockedSteps.length > 0) {
      for (const step of categorySteps) {
        if (step.provenance === SuggestionStepProvenance.SpecialistLocked) {
          continue;
        }
        keptSteps.delete(step);
        changed = true;
      }
      continue;
    }

    const [selectedStep, ...duplicateSteps] = [...categorySteps].sort(
      (left, right) =>
        singleUseStepSuitability(right, scoreByProductId) -
          singleUseStepSuitability(left, scoreByProductId) ||
        singleUseProvenanceRank(right) - singleUseProvenanceRank(left) ||
        left.stepOrder - right.stepOrder,
    );
    if (!selectedStep) continue;
    for (const step of duplicateSteps) {
      keptSteps.delete(step);
      changed = true;
    }
  }

  return changed ? steps.filter((step) => keptSteps.has(step)) : steps;
}

function singleUseCategoryForStep(
  step: SuggestionGenerationStepOutput,
): ProductCategory | null {
  if (!PRODUCT_CATEGORY_VALUES.has(step.stepLabel)) return null;
  const category = step.stepLabel as ProductCategory;
  return isSingleUseSuggestionCategory(category) ? category : null;
}

function singleUseStepSuitability(
  step: SuggestionGenerationStepOutput,
  scoreByProductId: ReadonlyMap<
    string,
    SuggestionContextSummary['productScores'][number]
  >,
): number {
  if (!step.inventoryProductId) return -1;
  return scoreByProductId.get(step.inventoryProductId)?.suitabilityScore ?? -1;
}

function singleUseProvenanceRank(step: SuggestionGenerationStepOutput): number {
  switch (step.provenance) {
    case SuggestionStepProvenance.UserRoutine:
      return 2;
    case SuggestionStepProvenance.AiAdded:
      return 1;
    default:
      return 0;
  }
}

function repairConflictingLowerScoredAiSelection(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  const scoreByProductId = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  let repaired = false;
  const selectedProductIds = new Set(
    steps
      .map((step) => step.inventoryProductId)
      .filter((productId): productId is string => Boolean(productId)),
  );
  const selectedScores = steps
    .map((step) =>
      step.inventoryProductId
        ? scoreByProductId.get(step.inventoryProductId)
        : null,
    )
    .filter(
      (score): score is SuggestionContextSummary['productScores'][number] =>
        Boolean(score),
    );

  const repairedSteps = steps.map((step) => {
    if (
      step.provenance !== SuggestionStepProvenance.AiAdded ||
      !step.inventoryProductId
    ) {
      return step;
    }
    const selectedScore = scoreByProductId.get(step.inventoryProductId);
    if (!selectedScore) return step;
    const replacementScore = [...scoreByProductId.values()]
      .filter((candidate) => !selectedProductIds.has(candidate.productId))
      .filter((candidate) =>
        isEligibleConflictReplacementCandidate(inputs, candidate),
      )
      .filter(
        (candidate) =>
          candidate.suitabilityScore >=
          selectedScore.suitabilityScore + CONFLICT_REPLACEMENT_SCORE_MARGIN,
      )
      .filter((candidate) => hasAiLayeringConflict(candidate, selectedScore))
      .filter((candidate) =>
        selectedScores
          .filter((score) => score.productId !== selectedScore.productId)
          .every((score) => areAiProductsCompatible(candidate, score)),
      )
      .sort((left, right) => right.suitabilityScore - left.suitabilityScore)[0];
    if (!replacementScore) return step;
    const replacementStep = buildAiStepForProductScore(
      inputs,
      replacementScore,
      step.stepOrder,
    );
    if (!replacementStep?.inventoryProductId) return step;
    selectedProductIds.delete(step.inventoryProductId);
    selectedProductIds.add(replacementStep.inventoryProductId);
    repaired = true;
    return replacementStep;
  });

  return repaired ? orderBaselineSteps(repairedSteps) : steps;
}

function isEligibleConflictReplacementCandidate(
  inputs: SuggestionGenerationInputs,
  score: SuggestionContextSummary['productScores'][number],
): boolean {
  if (!hasCurrentSelectionEvidence(inputs, score.productId)) return false;
  if (
    !isPreferredTimeCompatibleWithDaypart(
      score.preferredTimeOfDay,
      inputs.daypart,
    )
  ) {
    return false;
  }
  if (
    inputs.contextSummary.skippedCandidates.some(
      (candidate) =>
        candidate.productId === score.productId &&
        !/recent same-daypart repeat/i.test(candidate.reason) &&
        isBlockingSkippedCandidateReason(candidate.reason),
    )
  ) {
    return false;
  }
  return canRepairManualRoutineStep(inputs, score);
}

function buildAiStepForProductScore(
  inputs: SuggestionGenerationInputs,
  score: SuggestionContextSummary['productScores'][number],
  stepOrder: number,
): SuggestionGenerationStepOutput | null {
  return resolveRawStep(
    {
      stepOrder,
      routineStepId: null,
      inventoryProductId: score.productId,
      stepLabel: score.category,
      explanation:
        'Selected because the current scoring better supports this slot and conflicting products should not be layered together.',
      provenance: SuggestionStepProvenance.AiAdded,
    },
    stepOrder,
    buildAssemblyContext(inputs),
  );
}

function areAiProductsCompatible(
  left: SuggestionContextSummary['productScores'][number],
  right: SuggestionContextSummary['productScores'][number],
): boolean {
  return !hasAiLayeringConflict(left, right);
}

function hasAiLayeringConflict(
  left: SuggestionContextSummary['productScores'][number],
  right: SuggestionContextSummary['productScores'][number],
): boolean {
  return (
    hasSingleUseAiCategoryConflict(left, right) ||
    hasExplicitAiLayeringConflict(left, right) ||
    hasStrongActiveAiLayeringConflict(left, right) ||
    hasVitaminCNiacinamideAiConflict(left, right)
  );
}

function hasSingleUseAiCategoryConflict(
  left: SuggestionContextSummary['productScores'][number],
  right: SuggestionContextSummary['productScores'][number],
): boolean {
  return (
    left.category === right.category &&
    isSingleUseSuggestionCategory(left.category)
  );
}

function hasExplicitAiLayeringConflict(
  left: SuggestionContextSummary['productScores'][number],
  right: SuggestionContextSummary['productScores'][number],
): boolean {
  const text = [
    ...left.cautionReasons,
    ...right.cautionReasons,
    ...(left.guidanceCautions ?? []),
    ...(right.guidanceCautions ?? []),
  ].join(' ');
  return /(?:do not|don't|avoid|separate|split|alternate).{0,40}(?:layer|combine|mix|same routine|together)|(?:layer|combine|mix).{0,40}(?:irritat|unstable|less comfortable|not recommended)/i.test(
    text,
  );
}

function hasStrongActiveAiLayeringConflict(
  left: SuggestionContextSummary['productScores'][number],
  right: SuggestionContextSummary['productScores'][number],
): boolean {
  return (
    left.activeTags.some(isStrongActiveTag) &&
    right.activeTags.some(isStrongActiveTag)
  );
}

function hasVitaminCNiacinamideAiConflict(
  left: SuggestionContextSummary['productScores'][number],
  right: SuggestionContextSummary['productScores'][number],
): boolean {
  const leftTags = new Set(left.activeTags);
  const rightTags = new Set(right.activeTags);
  return (
    (leftTags.has('vitamin_c') && rightTags.has('niacinamide')) ||
    (leftTags.has('niacinamide') && rightTags.has('vitamin_c'))
  );
}

function repairMissingEligibleManualRoutineSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  const selectedRoutineStepIds = new Set(
    steps
      .map((step) => step.routineStepId)
      .filter((routineStepId): routineStepId is string =>
        Boolean(routineStepId),
      ),
  );
  const selectedProductIds = new Set(
    steps
      .map((step) => step.inventoryProductId)
      .filter((productId): productId is string => Boolean(productId)),
  );
  const scoreByProductId = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  const missingManualSteps = inputs.routineSteps
    .filter((step) => !step.is_specialist_locked)
    .filter((step) => isRoutineStepEligibleForSuggestions(inputs, step))
    .filter((step) => Boolean(step.inventory_product_id))
    .filter((step) => !selectedRoutineStepIds.has(step.id))
    .filter(
      (step) =>
        !step.inventory_product_id ||
        !selectedProductIds.has(step.inventory_product_id),
    )
    .filter((step) =>
      step.inventory_product_id
        ? hasCurrentSelectionEvidence(inputs, step.inventory_product_id)
        : false,
    )
    .filter((step) => {
      const score = step.inventory_product_id
        ? scoreByProductId.get(step.inventory_product_id)
        : null;
      return score ? canRepairManualRoutineStep(inputs, score) : false;
    })
    .sort((left, right) => left.step_order - right.step_order);

  if (missingManualSteps.length === 0) return steps;

  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  return [
    ...steps,
    ...missingManualSteps.map((step) =>
      routineStepToOutput(step, step.step_order, { language }),
    ),
  ];
}

function canRepairManualRoutineStep(
  inputs: SuggestionGenerationInputs,
  score: SuggestionContextSummary['productScores'][number],
): boolean {
  if (
    hasPregnancyOrMedicationCaution(inputs) &&
    hasPregnancyCautionActive(score)
  ) {
    return false;
  }
  if (hasMedicationStrongActiveCaution(inputs) && hasStrongActive(score)) {
    return false;
  }
  if (hasSensitiveReactiveHistoryStrongActiveCaution(inputs, score)) {
    return false;
  }
  if (hasReactionSignalInInputs(inputs) && hasStrongActive(score)) {
    return false;
  }
  if (
    inputs.contextSummary.routineBreak.recentlyResumed &&
    hasStrongActive(score)
  ) {
    return false;
  }
  if (hasDaytimeStrongActiveConflict(inputs, score)) return false;
  if (hasDryBarrierStrongActiveCaution(inputs, score)) return false;
  return !(requiresRecentStrongActiveSpacing(inputs) && hasStrongActive(score));
}

const MINIMAL_SUPPORT_MAX_STEPS = 4;
const IMMEDIATE_SUPPORT_CATEGORIES = new Set<ProductCategory>([
  ProductCategory.Cleanser,
  ProductCategory.Moisturizer,
  ProductCategory.SunProtection,
]);
const THIN_MORNING_SUPPORT_TRIGGER_CATEGORIES = new Set<ProductCategory>([
  ProductCategory.Cleanser,
  ProductCategory.Moisturizer,
  ProductCategory.Serum,
  ProductCategory.Treatment,
  ProductCategory.Exfoliant,
]);

function repairMissingMinimalRoutineSupport(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  if (!prefersStoredMinimalRoutine(inputs)) return steps;
  if (steps.length >= MINIMAL_SUPPORT_MAX_STEPS) return steps;

  const selectedScores = selectedProductScores(inputs, steps);
  const selectedOptionalScores = selectedScores.filter(
    (score) => !IMMEDIATE_SUPPORT_CATEGORIES.has(score.category),
  );
  if (selectedOptionalScores.length === 0) return steps;

  const selectedProductIds = new Set(
    steps
      .map((step) => step.inventoryProductId)
      .filter((productId): productId is string => Boolean(productId)),
  );
  const lowestOptionalScore = Math.min(
    ...selectedOptionalScores.map((score) => score.suitabilityScore),
  );
  const scoreByProductId = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  const supportSteps = buildDeterministicAiSteps(inputs).filter((step) => {
    if (!step.inventoryProductId) return false;
    if (selectedProductIds.has(step.inventoryProductId)) return false;
    if (!IMMEDIATE_SUPPORT_CATEGORIES.has(step.stepLabel as ProductCategory)) {
      return false;
    }
    if (
      step.stepLabel === ProductCategory.SunProtection &&
      !requiresOwnedDaytimeSpf(inputs)
    ) {
      return false;
    }
    const score = scoreByProductId.get(step.inventoryProductId);
    return Boolean(score && score.suitabilityScore >= lowestOptionalScore);
  });
  if (supportSteps.length === 0) return steps;

  return orderBaselineSteps([
    ...steps,
    ...supportSteps.slice(0, MINIMAL_SUPPORT_MAX_STEPS - steps.length),
  ]);
}

function repairThinScheduledMorningSupport(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  if (inputs.requestSource !== SuggestionRequestSource.Scheduled) return steps;
  if (inputs.daypart !== SuggestionDaypart.Morning) return steps;
  if (!requiresOwnedDaytimeSpf(inputs)) return steps;
  if (steps.length >= 3) return steps;

  const selectedScores = selectedProductScores(inputs, steps);
  if (selectedScores.length === 0) return steps;
  if (
    !selectedScores.some(
      (score) => score.category === ProductCategory.SunProtection,
    )
  ) {
    return steps;
  }
  if (
    !selectedScores.some(
      (score) =>
        score.category !== ProductCategory.SunProtection &&
        THIN_MORNING_SUPPORT_TRIGGER_CATEGORIES.has(score.category),
    )
  ) {
    return steps;
  }

  const selectedCategories = new Set(
    selectedScores.map((score) => score.category),
  );
  const selectedProductIds = new Set(
    steps
      .map((step) => step.inventoryProductId)
      .filter((productId): productId is string => Boolean(productId)),
  );
  let repairedSteps = steps;
  for (const category of [
    ProductCategory.Cleanser,
    ProductCategory.Moisturizer,
  ]) {
    if (repairedSteps.length >= 3 || selectedCategories.has(category)) {
      continue;
    }
    const supportStep = buildDeterministicAiStepForCategory(
      inputs,
      category,
      selectedProductIds,
    );
    if (!supportStep?.inventoryProductId) continue;
    selectedProductIds.add(supportStep.inventoryProductId);
    selectedCategories.add(category);
    repairedSteps = [...repairedSteps, supportStep];
  }

  return repairedSteps.length === steps.length
    ? steps
    : orderBaselineSteps(repairedSteps);
}

function prefersStoredMinimalRoutine(
  inputs: SuggestionGenerationInputs,
): boolean {
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

function orderGeneratedSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  hasLockedInput: boolean,
): SuggestionGenerationStepOutput[] {
  const applyStableOrder = (orderedSteps: SuggestionGenerationStepOutput[]) =>
    orderedSteps.map((step, index) => ({ ...step, stepOrder: index }));

  if (hasLockedInput || inputs.routineSteps.length > 0) {
    return applyStableOrder(
      [...steps].sort((left, right) => left.stepOrder - right.stepOrder),
    );
  }
  return orderBaselineSteps(steps);
}

function normalizeExplanationForSelectedSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  explanation: SuggestionExplanationJson,
): SuggestionExplanationJson {
  const selectedProductLabels = selectedProductLabelsForSteps(steps);
  const perStepReasons = steps.map((step) => ({
    stepOrder: step.stepOrder,
    reason: step.explanation ?? 'Good fit for this slot.',
  }));
  const body = [
    ...explanation.body.filter(
      (line) =>
        !isConditionalSelectedSpfText(steps, line) &&
        !isOffSlotSunscreenCopy(inputs, line) &&
        !isUnselectedStrongActiveCopy(inputs, selectedProductLabels, line),
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
    headline: isUnselectedStrongActiveCopy(
      inputs,
      selectedProductLabels,
      explanation.headline,
    )
      ? safeHeadline(inputs)
      : explanation.headline,
    body,
    perStepReasons,
    skipped,
    inputs: normalizeExplanationInputs(
      inputs,
      explanation.inputs,
      selectedProductLabels,
    ),
  };
}

function normalizeExplanationInputs(
  inputs: SuggestionGenerationInputs,
  explanationInputs: SuggestionExplanationJson['inputs'],
  selectedProductLabels: Set<string>,
): SuggestionExplanationJson['inputs'] {
  return explanationInputs
    .map((input) => ({
      ...input,
      detail: removeUnsupportedProfileClaims(inputs, input.detail),
    }))
    .filter(
      (input) =>
        input.label.trim() &&
        input.detail.trim() &&
        !isSensitiveExplanationInputLabel(input.label) &&
        !isUnselectedStrongActiveCopy(
          inputs,
          selectedProductLabels,
          `${input.label} ${input.detail}`,
        ),
    );
}

function selectedProductLabelsForSteps(
  steps: SuggestionGenerationStepOutput[],
): Set<string> {
  return new Set(
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
}

function sanitizeStepExplanationsForSelectedSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  const selectedProductLabels = selectedProductLabelsForSteps(steps);
  return steps.map((step) => {
    if (
      !step.explanation ||
      !isUnselectedStrongActiveCopy(
        inputs,
        selectedProductLabels,
        step.explanation,
      )
    ) {
      return step;
    }
    return {
      ...step,
      explanation: safeStepExplanation(step.stepLabel),
    };
  });
}

function safeStepExplanation(stepLabel: StepLabel): string {
  switch (stepLabel) {
    case ProductCategory.Cleanser:
      return 'Gentle cleanse fits this slot.';
    case ProductCategory.Moisturizer:
      return 'Barrier support fits this slot.';
    case ProductCategory.SunProtection:
      return 'Daytime protection fits this slot.';
    default:
      return 'This selected shelf product fits the current context.';
  }
}

function safeHeadline(inputs: SuggestionGenerationInputs): string {
  return inputs.daypart === SuggestionDaypart.Evening
    ? 'Gentle evening routine'
    : 'Gentle routine';
}

function removeUnsupportedProfileClaims(
  inputs: SuggestionGenerationInputs,
  detail: string,
): string {
  const withoutSensitiveClaims = removeSensitiveProfileClaims(detail);
  if (hasHighPihTendency(inputs)) return withoutSensitiveClaims;
  return withoutSensitiveClaims
    .replace(/,\s*high PIH tendency\b/gi, '')
    .replace(/\bhigh PIH tendency,\s*/gi, '')
    .replace(/\bhigh PIH tendency\b/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;]\s*|\s*[,;]\s*$/g, '')
    .trim();
}

function removeSensitiveProfileClaims(detail: string): string {
  return detail
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !isSensitiveProfileClaim(part))
    .join('; ')
    .replace(
      /\b(ethnicity|race|countryCode|country|city|location|fitzpatrick(?:Phototype)?|phototype)\s*[:=]\s*[^,;]+,?\s*/gi,
      '',
    )
    .replace(/\s*;\s*;/g, ';')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;]\s*|\s*[,;]\s*$/g, '')
    .trim();
}

function isSensitiveProfileClaim(value: string): boolean {
  return /^(?:ethnicity|race|countryCode|country|city|location|fitzpatrick(?:Phototype)?|phototype)\s*[:=]/i.test(
    value,
  );
}

function isSensitiveExplanationInputLabel(label: string): boolean {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return [
    'ethnicity',
    'race',
    'country',
    'countrycode',
    'city',
    'location',
    'fitzpatrick',
    'fitzpatrickphototype',
    'phototype',
  ].includes(normalized);
}

function isUnselectedStrongActiveCopy(
  inputs: SuggestionGenerationInputs,
  selectedProductLabels: Set<string>,
  line: string,
): boolean {
  const normalizedLine = normalizeProductCopy(line);
  if (!normalizedLine) return false;
  const shelfProductById = new Map(
    inputs.shelfActiveProducts.map((product) => [product.id, product]),
  );
  return resolveSuggestionProductScores(inputs)
    .filter(hasStrongActive)
    .filter((score) => {
      const shelfProduct = shelfProductById.get(score.productId);
      const selectedLabels = [
        score.productId,
        shelfProduct?.name,
        [shelfProduct?.brand, shelfProduct?.name].filter(Boolean).join(' '),
        score.name,
        [score.brand, score.name].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .map(normalizeProductCopy);
      return !selectedLabels.some((label) => selectedProductLabels.has(label));
    })
    .some((score) => {
      const shelfProduct = shelfProductById.get(score.productId);
      return [
        score.productId,
        shelfProduct?.name,
        [shelfProduct?.brand, shelfProduct?.name].filter(Boolean).join(' '),
        score.name,
        [score.brand, score.name].filter(Boolean).join(' '),
        ...score.activeTags,
      ]
        .filter((label): label is string => Boolean(label))
        .map((label) => normalizeProductCopy(label.replace(/_/g, ' ')))
        .some((label) => label.length > 0 && normalizedLine.includes(label));
    });
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      : [candidate.brand, candidate.name].filter(Boolean).join(' ') ||
        candidate.productId;
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
  if (hasBlockedProductIntroductionStatusStep(inputs, steps)) {
    return 'blocked_product_introduction_status';
  }
  const selectedScores = selectedProductScores(inputs, steps);
  if (
    hasPregnancyOrMedicationCaution(inputs) &&
    selectedScores.some(hasPregnancyCautionActive)
  ) {
    return 'unsafe_pregnancy_active';
  }
  if (
    hasMedicationStrongActiveCaution(inputs) &&
    selectedScores.some(hasStrongActive)
  ) {
    return 'unsafe_medication_strong_active';
  }
  if (
    hasReactionSignalInInputs(inputs) &&
    selectedScores.some(hasStrongActive)
  ) {
    return 'unsafe_reaction_active';
  }
  if (
    selectedScores.some((score) =>
      hasSensitiveReactiveHistoryStrongActiveCaution(inputs, score),
    )
  ) {
    return 'unsafe_sensitive_history_active';
  }
  if (
    inputs.contextSummary.routineBreak.recentlyResumed &&
    selectedScores.some(hasStrongActive)
  ) {
    return 'unsafe_restart_active';
  }
  if (
    selectedScores.some((score) =>
      hasDryBarrierStrongActiveCaution(inputs, score),
    )
  ) {
    return 'unsafe_dry_barrier_active';
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
  const hasSuppliedPhotosensitivitySignal =
    /(?:space_strong_actives|avoid_new_strong_actives|avoid_daytime_strong_active|avoid_daytime_active|photosensit|high_uv|very_high_uv|extreme_uv|sun[- ]?sensitive|sun sensitivity|sun exposure|sunlight)/i.test(
      JSON.stringify([
        score.cautionReasons,
        inputs.contextSummary.safetyConstraints,
      ]),
    );
  return (
    hasSuppliedPhotosensitivitySignal ||
    (inputs.contextSummary.environment
      ? isHighUvRisk(inputs.contextSummary.environment.uvRisk)
      : false)
  );
}

function hasDryBarrierStrongActiveCaution(
  inputs: SuggestionGenerationInputs,
  score: SuggestionContextSummary['productScores'][number],
): boolean {
  return hasStrongActive(score) && hasDryBarrierSelectionContext(inputs);
}

function hasDryBarrierSelectionContext(
  inputs: SuggestionGenerationInputs,
): boolean {
  const environment = inputs.contextSummary.environment;
  const dryEnvironment = environment
    ? isDryHumidity(environment.humidityBand)
    : false;
  const coldDryEnvironment = Boolean(
    dryEnvironment &&
    environment?.temperatureBand &&
    ['cold', 'freezing'].includes(environment.temperatureBand),
  );
  const environmentBarrierSignal =
    inputs.contextSummary.safetyConstraints.includes(
      'environment_barrier_support',
    ) ||
    (environment?.climateSensitivities ?? []).includes('dry_air') ||
    coldDryEnvironment;
  if (!dryEnvironment && !environmentBarrierSignal) return false;

  const currentConcernText = JSON.stringify([
    inputs.skinProfile?.primary_goal ?? '',
    inputs.skinProfile?.current_concerns ?? [],
    inputs.contextSummary.skinProfile.primaryGoal ?? '',
    inputs.contextSummary.skinProfile.activeConcerns,
    inputs.contextSummary.reaction.indicators,
    inputs.contextSummary.reaction.concernKeys,
  ]).toLowerCase();
  return /\b(dry|dryness|flaking|barrier|tight|stinging|burning)\b/i.test(
    currentConcernText,
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

function hasBlockedProductIntroductionStatusStep(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): boolean {
  const blockedProductIds = new Set(
    inputs.shelfActiveProducts
      .filter(
        (product) =>
          !isProductIntroductionEligibleForSuggestions(
            product.introduction_status,
          ),
      )
      .map((product) => product.id),
  );
  if (blockedProductIds.size === 0) return false;
  return steps.some(
    (step) =>
      typeof step.inventoryProductId === 'string' &&
      blockedProductIds.has(step.inventoryProductId),
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

function hasMedicationStrongActiveCaution(
  inputs: SuggestionGenerationInputs,
): boolean {
  const safetyContext = inputs.skinProfile?.safety_context ?? {};
  const text = JSON.stringify([
    safetyContext.medications ?? [],
    safetyContext.conditions ?? [],
    safetyContext.photosensitizing_other
      ? 'photosensitizing medication context'
      : '',
    inputs.skinProfile?.under_dermatologist_care ?? '',
    inputs.contextSummary.safetyConstraints,
  ]).toLowerCase();
  return /\b(medication|medicine|isotretinoin|antibiotic|photosensit|dermatologist|prescriber|clinician|professional)\b/i.test(
    text,
  );
}

function hasSensitiveReactiveHistoryStrongActiveCaution(
  inputs: SuggestionGenerationInputs,
  score: SuggestionContextSummary['productScores'][number],
): boolean {
  if (!hasStrongActive(score)) return false;
  if (hasPositiveStrongActiveTolerance(inputs, score)) return false;
  const profile = inputs.skinProfile;
  const sensitivityText = JSON.stringify([
    profile?.skin_type ?? '',
    profile?.sensitivity_level ?? '',
    inputs.contextSummary.skinProfile.skinType ?? '',
    inputs.contextSummary.skinProfile.sensitivityLevel ?? '',
  ]).toLowerCase();
  if (!/\b(sensitive|high)\b/i.test(sensitivityText)) return false;
  const reactionText = JSON.stringify([
    profile?.reaction_history ?? {},
    profile?.shopping_preferences ?? {},
  ]).toLowerCase();
  return /\b(reaction|reacted|redness|sting|stinging|burn|burning|itch|rash|irritat|fragrance|sensitiv)\b/i.test(
    reactionText,
  );
}

function hasPositiveStrongActiveTolerance(
  inputs: SuggestionGenerationInputs,
  score: SuggestionContextSummary['productScores'][number],
): boolean {
  const product = inputs.shelfActiveProducts.find(
    (shelfProduct) => shelfProduct.id === score.productId,
  );
  if (product?.introduction_status === ProductIntroductionStatus.Tolerated) {
    return true;
  }
  const toleranceText = JSON.stringify(
    inputs.skinProfile?.active_tolerances ?? {},
  ).toLowerCase();
  if (!toleranceText) return false;
  return score.activeTags
    .filter((tag) => isStrongActiveTag(tag))
    .some((tag) => {
      const normalizedTag = tag.toLowerCase().replace(/_/g, ' ');
      return new RegExp(
        `${escapeRegExp(normalizedTag)}[\\s\\S]{0,80}(tolerat|medium|high|good)`,
        'i',
      ).test(toleranceText);
    });
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

function repairContradictoryOnlyCopy(
  explanation: SuggestionExplanationJson,
): SuggestionExplanationJson {
  return {
    ...explanation,
    headline: removeOnlyWord(explanation.headline),
    body: explanation.body.map(removeOnlyWord).filter(Boolean),
  };
}

function repairMissingMedicationCautionCopy(
  inputs: SuggestionGenerationInputs,
  explanation: SuggestionExplanationJson,
): SuggestionExplanationJson {
  const bodyText = explanation.body.join(' ');
  if (hasMedicationProfessionalGuidance(bodyText)) return explanation;
  return {
    ...explanation,
    body: [...explanation.body, medicationProfessionalGuidanceLine(inputs)],
  };
}

function removeOnlyWord(value: string): string {
  return value
    .replace(/\bonly\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
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
