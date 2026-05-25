import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFeatureOpenAiModel } from '../../common/utils/openai-config';
import { openAiRepeatabilityRequestOptions } from '../../common/utils/openai-request-options';
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
  hasUnjustifiedHistoryNoveltyStep,
  requiresOwnedDaytimeSpf,
} from './suggestion-routine-repeat-policy';

export const SUGGESTION_AI_MODEL_ENV_KEY = 'SUGGESTION_AI_MODEL';
export const SUGGESTION_AI_TIMEOUT_MS = 45_000;
export const SUGGESTION_AI_MAX_OUTPUT_TOKENS = 1500;

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
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          store: false,
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: buildPrompt(inputs) }],
            },
          ],
          max_output_tokens: SUGGESTION_AI_MAX_OUTPUT_TOKENS,
          ...openAiRepeatabilityRequestOptions(model),
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

      const payload = (await response.json()) as OpenAiResponsePayload;
      const outputText = extractOutputText(payload);
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
        return this.buildBaseline(
          inputs,
          Date.now() - metadata.durationMs,
          metadata.model,
          'invalid_product_or_step_reference',
        );
      }
      steps.push(resolved);
    }
    const hardSafetyFallbackReason = resolveHardSafetyFallbackReason(
      inputs,
      steps,
    );
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
    const explanation = sanitizeExplanation(
      raw.explanation ?? defaultExplanation(),
    );
    const copyFallbackReason = resolveCopyFallbackReason(
      inputs,
      steps,
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
    return {
      mode: computeMode(steps, context.lockedSteps.length > 0),
      hasReactionSignal,
      simplifiedForReaction:
        Boolean(raw.simplifiedForReaction) && hasReactionSignal,
      explanation,
      gapRecommendations: filterContextualGapRecommendations(
        inputs,
        steps,
        sanitizeGapRecommendations(raw.gapRecommendations ?? []),
      ),
      safetyFlags: [
        ...sanitizeSafetyFlags(raw.safetyFlags ?? []),
        ...buildDeterministicSafetyFlags(inputs, steps),
      ],
      steps: steps.sort((a, b) => a.stepOrder - b.stepOrder),
      metadata: {
        ...metadata,
        promptVersion: SUGGESTION_PROMPT_VERSION,
      },
    };
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

function buildManualBaselineSteps(
  inputs: SuggestionGenerationInputs,
  orderedSteps: RoutineStep[],
  fallbackReason: string | null,
): SuggestionGenerationStepOutput[] {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  const routineOutputs = orderedSteps.map((step, index) =>
    routineStepToOutput(step, index, { language }),
  );
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
    inputs.routineSteps.length === 0 &&
    (inputs.shelfActiveProducts.length === 0 ||
      inputs.contextSummary.productScores.length === 0)
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
  if (hasUnjustifiedHistoryNoveltyStep(inputs, steps)) {
    return 'unjustified_history_novelty';
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
    inputs.contextSummary.productScores.map((score) => [
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

function isSkippedProductReturnedAsStep(
  step: SuggestionGenerationStepOutput,
): boolean {
  if (!step.inventoryProductId) return false;
  return /\b(skip|skipped|delay|not use|avoid using|save for another)\b/i.test(
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
  return /\b(medication|pregnan|breastfeed|clinician|specialist|doctor|prescrib)\b/i.test(
    explanation.body.join(' '),
  );
}

function isConditionalSpfStep(
  inputs: SuggestionGenerationInputs,
  step: SuggestionGenerationStepOutput,
): boolean {
  const score = step.inventoryProductId
    ? inputs.contextSummary.productScores.find(
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
  const hasMoisturizer = inputs.contextSummary.productScores.some(
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
  return gaps.filter((gap) => {
    if (isOwnedProductGap(inputs, gap)) return false;
    if (!isSunscreenGap(gap)) return true;
    if (inputs.daypart !== SuggestionDaypart.Evening) return true;
    if (selectedPhotosensitizingActive) return true;
    if (needsPigmentOrUvProtection(inputs)) return true;
    return false;
  });
}

function isOwnedProductGap(
  inputs: SuggestionGenerationInputs,
  gap: SuggestionGapRecommendationJson,
): boolean {
  const text = `${gap.ingredientOrCategory} ${gap.reason} ${
    gap.goalAlignment ?? ''
  }`.toLowerCase();
  return inputs.contextSummary.productScores.some((score) => {
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
