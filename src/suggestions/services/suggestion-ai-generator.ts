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
  describeOpenAiPayloadIssue,
  estimateCost,
  extractOutputText,
  OpenAiResponsePayload,
  parseStructuredOutputJson,
  RawSuggestionResponse,
  RESPONSE_FORMAT,
  SYSTEM_PROMPT,
} from './suggestion-ai-contract';
import {
  agentRepairInstructions,
  agentReviewPassed,
  buildAgenticSuggestionPrompt,
  buildSuggestionAgentPlanningPrompt,
  buildSuggestionAgentReviewPrompt,
  SUGGESTION_AGENT_GENERATION_ATTEMPTS,
  SUGGESTION_AGENT_PLAN_MAX_OUTPUT_TOKENS,
  SUGGESTION_AGENT_PLAN_RESPONSE_FORMAT,
  SUGGESTION_AGENT_PLANNER_SYSTEM_PROMPT,
  SUGGESTION_AGENT_REVIEW_MAX_OUTPUT_TOKENS,
  SUGGESTION_AGENT_REVIEW_RESPONSE_FORMAT,
  SUGGESTION_AGENT_REVIEW_SYSTEM_PROMPT,
  type SuggestionAgentPlan,
  type SuggestionAgentReview,
} from './suggestion-agent-contract';
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
  isLeaveOnStrongActiveScore,
  isPreferredTimeCompatibleWithDaypart,
  isSingleUseSuggestionCategory,
  isStrongActiveTag,
} from './suggestion-product-intelligence';
import {
  hasIngredientAnalysisLayeringConflict,
  hasSpecificTextLayeringConflict,
} from './suggestion-product-compatibility';
import { isBlockingSkippedCandidateReason } from './suggestion-safety-policy';
import {
  buildCategoryStepExplanation,
  buildProductScoreStepExplanation,
} from './suggestion-step-explanations';

export const SUGGESTION_AI_MODEL_ENV_KEY = 'SUGGESTION_AI_MODEL';
export const SUGGESTION_AI_TODAYS_TIMEOUT_MS = 480_000;
export const SUGGESTION_AI_QUICK_TIMEOUT_MS = 180_000;
export const SUGGESTION_AI_TIMEOUT_MS = SUGGESTION_AI_TODAYS_TIMEOUT_MS;
export const SUGGESTION_AI_MAX_OUTPUT_TOKENS = 24000;
const SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS = 2;
const SUGGESTION_AI_TODAYS_PROVIDER_FAILURE_ATTEMPTS = 4;
const SUGGESTION_AI_QUICK_PROVIDER_FAILURE_ATTEMPTS = 1;
const SUGGESTION_AGENT_AUXILIARY_PROVIDER_FAILURE_ATTEMPTS = 2;
const SUGGESTION_AGENT_AUXILIARY_CALL_TIMEOUT_MS = 150_000;
const SUGGESTION_AI_MIN_RETRY_TIMEOUT_MS = 1_000;
const SUGGESTION_AI_RATE_LIMIT_RETRY_BASE_DELAY_MS = 15_000;
const SUGGESTION_AI_RATE_LIMIT_RETRY_MAX_DELAY_MS = 60_000;
const SUGGESTION_AI_TRANSIENT_RETRY_BASE_DELAY_MS = 250;
const SUGGESTION_AI_TRANSIENT_RETRY_MAX_DELAY_MS = 2_000;
const SUGGESTION_AI_ERROR_DETAIL_MAX_CHARS = 240;
type OpenAiJsonSchemaResponseFormat =
  | typeof RESPONSE_FORMAT
  | typeof SUGGESTION_AGENT_PLAN_RESPONSE_FORMAT
  | typeof SUGGESTION_AGENT_REVIEW_RESPONSE_FORMAT;

const PRACTICAL_STEP_CATEGORY_ORDER: StepLabel[] = [
  ProductCategory.Cleanser,
  ProductCategory.Mask,
  ProductCategory.Exfoliant,
  ProductCategory.Toner,
  ProductCategory.Essence,
  ProductCategory.Serum,
  ProductCategory.Treatment,
  ProductCategory.EyeCare,
  ProductCategory.Moisturizer,
  ProductCategory.SunProtection,
  ProductCategory.LipCare,
  ProductCategory.Other,
  'custom',
];

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
      if (inputs.requestSource === SuggestionRequestSource.Scheduled) {
        return await this.generateScheduledAgentic({
          apiKey,
          model,
          prompt,
          inputs,
          startedAt,
        });
      }
      const { rawOutput, payload } = await this.requestStructuredOutput({
        apiKey,
        model,
        prompt,
        reasoningEffort: suggestionReasoningEffort(inputs),
        timeoutMs: suggestionTimeoutMs(inputs),
        providerFailureAttempts: suggestionProviderFailureAttempts(inputs),
      });
      if (!rawOutput) {
        const payloadIssue = describeOpenAiPayloadIssue(payload);
        throw new Error(
          `OpenAI returned no usable structured output${
            payloadIssue ? ` (${payloadIssue})` : ''
          }.`,
        );
      }
      return this.assembleOutput(inputs, rawOutput, {
        model,
        durationMs: Date.now() - startedAt,
        ...metadataUsageFromPayloads([payload]),
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

  private async generateScheduledAgentic(input: {
    apiKey: string;
    model: string;
    prompt: string;
    inputs: SuggestionGenerationInputs;
    startedAt: number;
  }): Promise<SuggestionGenerationOutput> {
    const payloads: OpenAiResponsePayload[] = [];
    let plan: SuggestionAgentPlan | null = null;
    try {
      const { parsedOutput, payload: planPayload } =
        await this.requestStructuredJson<SuggestionAgentPlan>({
          apiKey: input.apiKey,
          model: input.model,
          prompt: buildSuggestionAgentPlanningPrompt(input.prompt),
          systemPrompt: SUGGESTION_AGENT_PLANNER_SYSTEM_PROMPT,
          responseFormat: SUGGESTION_AGENT_PLAN_RESPONSE_FORMAT,
          maxOutputTokens: SUGGESTION_AGENT_PLAN_MAX_OUTPUT_TOKENS,
          reasoningEffort: suggestionReasoningEffort(input.inputs),
          timeoutMs: auxiliaryAgentTimeoutMs(
            input.startedAt,
            suggestionTimeoutMs(input.inputs),
          ),
          providerFailureAttempts:
            SUGGESTION_AGENT_AUXILIARY_PROVIDER_FAILURE_ATTEMPTS,
          startedAt: input.startedAt,
        });
      plan = parsedOutput;
      payloads.push(planPayload);
    } catch (error) {
      // The plan is bounded guidance, not a hard dependency: generation and
      // backend validation still enforce every hard rule without it.
      this.logger.warn(
        `Scheduled suggestion agent planning failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }. Continuing without a plan.`,
      );
    }

    let repairInstructions: string[] = [];
    let lastReview: SuggestionAgentReview | null = null;
    for (
      let attempt = 1;
      attempt <= SUGGESTION_AGENT_GENERATION_ATTEMPTS;
      attempt += 1
    ) {
      const { rawOutput, payload } = await this.requestStructuredOutput({
        apiKey: input.apiKey,
        model: input.model,
        prompt: buildAgenticSuggestionPrompt({
          basePrompt: input.prompt,
          plan: plan ?? {},
          repairInstructions,
        }),
        reasoningEffort: suggestionReasoningEffort(input.inputs),
        timeoutMs: suggestionTimeoutMs(input.inputs),
        providerFailureAttempts: suggestionProviderFailureAttempts(
          input.inputs,
        ),
        startedAt: input.startedAt,
      });
      payloads.push(payload);
      if (!rawOutput) {
        const payloadIssue = describeOpenAiPayloadIssue(payload);
        throw new Error(
          `OpenAI returned no usable scheduled suggestion${
            payloadIssue ? ` (${payloadIssue})` : ''
          }.`,
        );
      }

      let review: SuggestionAgentReview | null = null;
      try {
        const { parsedOutput, payload: reviewPayload } =
          await this.requestStructuredJson<SuggestionAgentReview>({
            apiKey: input.apiKey,
            model: input.model,
            prompt: buildSuggestionAgentReviewPrompt({
              basePrompt: input.prompt,
              plan: plan ?? {},
              output: rawOutput,
            }),
            systemPrompt: SUGGESTION_AGENT_REVIEW_SYSTEM_PROMPT,
            responseFormat: SUGGESTION_AGENT_REVIEW_RESPONSE_FORMAT,
            maxOutputTokens: SUGGESTION_AGENT_REVIEW_MAX_OUTPUT_TOKENS,
            reasoningEffort: suggestionReasoningEffort(input.inputs),
            timeoutMs: auxiliaryAgentTimeoutMs(
              input.startedAt,
              suggestionTimeoutMs(input.inputs),
            ),
            providerFailureAttempts:
              SUGGESTION_AGENT_AUXILIARY_PROVIDER_FAILURE_ATTEMPTS,
            startedAt: input.startedAt,
          });
        review = parsedOutput;
        payloads.push(reviewPayload);
      } catch (error) {
        // Self-review is a quality gate on top of deterministic backend
        // validation; accept the generated output when the review call
        // itself cannot complete.
        this.logger.warn(
          `Scheduled suggestion agent review request failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }. Accepting output pending backend validation.`,
        );
      }
      lastReview = review;
      if (!review || agentReviewPassed(review)) {
        return this.assembleOutput(input.inputs, rawOutput, {
          model: input.model,
          durationMs: Date.now() - input.startedAt,
          ...metadataUsageFromPayloads(payloads),
          provider: 'openai',
          fallbackReason: null,
        });
      }
      repairInstructions = agentRepairInstructions(review);
    }

    throw new Error(
      `Scheduled suggestion agent review failed: ${agentRepairInstructions(
        lastReview ?? {},
      ).join('; ')}`,
    );
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
    repairedSteps = repairSelectedLayeringConflicts(inputs, repairedSteps);
    repairedSteps = repairAiStepsAfterSpecialistLockedOrder(
      inputs,
      repairedSteps,
    );
    repairedSteps = trimOverlongAiRoutineSteps(
      inputs,
      repairedSteps,
      context.lockedSteps.length > 0,
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
        repairedSteps = trimOverlongAiRoutineSteps(
          inputs,
          repairAiStepsAfterSpecialistLockedOrder(
            inputs,
            repairSelectedLayeringConflicts(
              inputs,
              repairSingleUseCategoryDuplicates(inputs, recoveredSteps),
            ),
          ),
          context.lockedSteps.length > 0,
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
    startedAt?: number;
  }): Promise<{
    rawOutput: RawSuggestionResponse | null;
    payload: OpenAiResponsePayload;
  }> {
    const startedAt = input.startedAt ?? Date.now();
    let lastPayload: OpenAiResponsePayload | null = null;
    let lastParseError: Error | null = null;
    for (
      let attempt = 1;
      attempt <= SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS;
      attempt += 1
    ) {
      const payload = await this.requestOpenAiResponseWithRetry({
        ...input,
        systemPrompt: SYSTEM_PROMPT,
        responseFormat: RESPONSE_FORMAT,
        maxOutputTokens: SUGGESTION_AI_MAX_OUTPUT_TOKENS,
        startedAt,
      });
      const outputText = extractOutputText(payload);
      if (outputText) {
        try {
          return {
            rawOutput:
              parseStructuredOutputJson<RawSuggestionResponse>(outputText),
            payload,
          };
        } catch (error) {
          lastPayload = payload;
          lastParseError =
            error instanceof Error
              ? error
              : new Error('unknown structured output parse error');
          if (
            attempt >= SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS ||
            remainingOpenAiTimeoutMs(input.timeoutMs, startedAt) <=
              SUGGESTION_AI_MIN_RETRY_TIMEOUT_MS
          ) {
            break;
          }
          this.logger.warn(
            `AI suggestion structured output attempt ${attempt} returned invalid JSON: ${lastParseError.message}. Retrying within the remaining timeout budget.`,
          );
          continue;
        }
      }
      lastPayload = payload;
      const payloadIssue = describeOpenAiPayloadIssue(payload);
      if (
        payloadIssue &&
        attempt < SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS &&
        remainingOpenAiTimeoutMs(input.timeoutMs, startedAt) >
          SUGGESTION_AI_MIN_RETRY_TIMEOUT_MS
      ) {
        this.logger.warn(
          `AI suggestion structured output attempt ${attempt} returned no usable output (${payloadIssue}). Retrying within the remaining timeout budget.`,
        );
      }
    }

    if (lastParseError) {
      throw new Error(
        `OpenAI returned invalid structured JSON: ${lastParseError.message}`,
      );
    }

    return {
      rawOutput: null,
      payload: lastPayload ?? {},
    };
  }

  private async requestStructuredJson<T>(input: {
    apiKey: string;
    model: string;
    prompt: string;
    systemPrompt: string;
    responseFormat: OpenAiJsonSchemaResponseFormat;
    maxOutputTokens: number;
    reasoningEffort: OpenAiReasoningEffort;
    timeoutMs: number;
    providerFailureAttempts: number;
    startedAt: number;
  }): Promise<{
    parsedOutput: T | null;
    payload: OpenAiResponsePayload;
  }> {
    let lastPayload: OpenAiResponsePayload | null = null;
    let lastParseError: Error | null = null;
    for (
      let attempt = 1;
      attempt <= SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS;
      attempt += 1
    ) {
      const payload = await this.requestOpenAiResponseWithRetry(input);
      const outputText = extractOutputText(payload);
      if (!outputText) {
        lastPayload = payload;
        const payloadIssue = describeOpenAiPayloadIssue(payload);
        if (
          payloadIssue &&
          attempt < SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS &&
          remainingOpenAiTimeoutMs(input.timeoutMs, input.startedAt) >
            SUGGESTION_AI_MIN_RETRY_TIMEOUT_MS
        ) {
          this.logger.warn(
            `AI suggestion agent structured output attempt ${attempt} returned no usable output (${payloadIssue}). Retrying within the remaining timeout budget.`,
          );
          continue;
        }
        return { parsedOutput: null, payload };
      }
      try {
        return {
          parsedOutput: parseStructuredOutputJson<T>(outputText),
          payload,
        };
      } catch (error) {
        lastPayload = payload;
        lastParseError =
          error instanceof Error
            ? error
            : new Error('unknown structured output parse error');
        if (
          attempt >= SUGGESTION_AI_STRUCTURED_OUTPUT_ATTEMPTS ||
          remainingOpenAiTimeoutMs(input.timeoutMs, input.startedAt) <=
            SUGGESTION_AI_MIN_RETRY_TIMEOUT_MS
        ) {
          break;
        }
        this.logger.warn(
          `AI suggestion agent structured output attempt ${attempt} returned invalid JSON: ${lastParseError.message}. Retrying within the remaining timeout budget.`,
        );
      }
    }
    if (lastParseError) {
      throw new Error(
        `OpenAI returned invalid agent JSON: ${lastParseError.message}`,
      );
    }
    return { parsedOutput: null, payload: lastPayload ?? {} };
  }

  private async requestOpenAiResponseWithRetry(input: {
    apiKey: string;
    model: string;
    prompt: string;
    systemPrompt: string;
    responseFormat: OpenAiJsonSchemaResponseFormat;
    maxOutputTokens: number;
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
        if (!isRetryableOpenAiFailure(error)) {
          throw error;
        }
        const retryDelayMs = openAiRetryDelayMs(error, attempt);
        const remainingMs = input.timeoutMs - (Date.now() - input.startedAt);
        if (
          attempt >= input.providerFailureAttempts ||
          remainingMs <= retryDelayMs + SUGGESTION_AI_MIN_RETRY_TIMEOUT_MS
        ) {
          throw error;
        }
        this.logger.warn(
          `AI suggestion provider attempt ${attempt} failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }. Retrying within the remaining timeout budget${
            retryDelayMs > 0 ? ` after ${retryDelayMs}ms` : ''
          }.`,
        );
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }
      }
    }
    throw new Error('OpenAI suggestion retry attempts exhausted.');
  }

  private async requestOpenAiResponse(input: {
    apiKey: string;
    model: string;
    prompt: string;
    systemPrompt: string;
    responseFormat: OpenAiJsonSchemaResponseFormat;
    maxOutputTokens: number;
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
            content: [{ type: 'input_text', text: input.systemPrompt }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: input.prompt }],
          },
        ],
        max_output_tokens: input.maxOutputTokens,
        ...openAiRepeatabilityRequestOptions(
          input.model,
          input.reasoningEffort,
        ),
        text: {
          verbosity: 'low',
          format: input.responseFormat,
        },
      }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });

    if (!response.ok) {
      throw new OpenAiSuggestionHttpError(
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
        await readOpenAiErrorDetail(response),
      );
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

class OpenAiSuggestionHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
    detail?: string | null,
  ) {
    super(
      `OpenAI suggestion call failed (${status})${detail ? `: ${detail}` : ''}.`,
    );
  }
}

async function readOpenAiErrorDetail(response: {
  text?: () => Promise<string>;
}): Promise<string | null> {
  try {
    const body = await response.text?.();
    if (!body?.trim()) return null;
    let detail = body;
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string; code?: string };
      };
      detail = parsed.error?.message ?? parsed.error?.code ?? body;
    } catch {
      // Keep the raw body when it is not JSON.
    }
    return detail.trim().slice(0, SUGGESTION_AI_ERROR_DETAIL_MAX_CHARS);
  } catch {
    return null;
  }
}

function isRetryableOpenAiFailure(error: unknown): boolean {
  if (error instanceof OpenAiSuggestionHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
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

// Auxiliary agent calls (plan, self-review) must never consume the whole
// generation budget: one hung plan request would otherwise starve the actual
// suggestion call. The effective remaining time for the auxiliary call is
// min(overall remaining budget, SUGGESTION_AGENT_AUXILIARY_CALL_TIMEOUT_MS).
function auxiliaryAgentTimeoutMs(
  startedAt: number,
  totalTimeoutMs: number,
): number {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  return Math.min(
    totalTimeoutMs,
    elapsedMs + SUGGESTION_AGENT_AUXILIARY_CALL_TIMEOUT_MS,
  );
}

function suggestionProviderFailureAttempts(
  inputs: SuggestionGenerationInputs,
): number {
  return inputs.requestSource === SuggestionRequestSource.Scheduled
    ? SUGGESTION_AI_TODAYS_PROVIDER_FAILURE_ATTEMPTS
    : SUGGESTION_AI_QUICK_PROVIDER_FAILURE_ATTEMPTS;
}

function metadataUsageFromPayloads(
  payloads: readonly OpenAiResponsePayload[],
): Pick<
  GenerationMetadata,
  'inputTokens' | 'outputTokens' | 'totalTokens' | 'estimatedCostUsd'
> {
  let sawUsage = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const usage of payloads.map((payload) => payload.usage)) {
    if (!usage) continue;
    sawUsage = true;
    inputTokens += usage.input_tokens ?? 0;
    outputTokens += usage.output_tokens ?? 0;
    totalTokens += usage.total_tokens ?? 0;
  }
  if (!sawUsage) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
    };
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: estimateCost({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    }),
  };
}

function openAiRetryDelayMs(error: unknown, attempt: number): number {
  if (error instanceof OpenAiSuggestionHttpError && error.status === 429) {
    if (error.retryAfterMs !== null) return error.retryAfterMs;
    return Math.min(
      SUGGESTION_AI_RATE_LIMIT_RETRY_BASE_DELAY_MS * attempt,
      SUGGESTION_AI_RATE_LIMIT_RETRY_MAX_DELAY_MS,
    );
  }
  return Math.min(
    SUGGESTION_AI_TRANSIENT_RETRY_BASE_DELAY_MS * attempt,
    SUGGESTION_AI_TRANSIENT_RETRY_MAX_DELAY_MS,
  );
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return null;
  return Math.max(0, retryAt - Date.now());
}

function remainingOpenAiTimeoutMs(totalTimeoutMs: number, startedAt: number) {
  const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    throw new Error('OpenAI suggestion timeout budget exhausted.');
  }
  return remainingMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const rank = (step: SuggestionGenerationStepOutput) => {
    return practicalStepCategoryRank(step.stepLabel);
  };
  return [...steps]
    .sort((left, right) => {
      const rankDiff = rank(left) - rank(right);
      return rankDiff || left.stepOrder - right.stepOrder;
    })
    .map((step, index) => ({ ...step, stepOrder: index }));
}

function practicalStepCategoryRank(stepLabel: StepLabel): number {
  const index = PRACTICAL_STEP_CATEGORY_ORDER.indexOf(stepLabel);
  return index >= 0 ? index : PRACTICAL_STEP_CATEGORY_ORDER.length;
}

function repairAiStepsAfterSpecialistLockedOrder(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  if (!inputs.routineSteps.some((step) => step.is_specialist_locked)) {
    return steps;
  }

  let precedingLockedRank = -1;
  const repaired = [...steps]
    .sort((left, right) => left.stepOrder - right.stepOrder)
    .filter((step) => {
      const rank = practicalStepCategoryRank(step.stepLabel);
      if (isSpecialistLockedGeneratedStep(inputs, step)) {
        precedingLockedRank = Math.max(precedingLockedRank, rank);
        return true;
      }
      if (
        step.provenance === SuggestionStepProvenance.AiAdded &&
        precedingLockedRank >= 0 &&
        rank < precedingLockedRank
      ) {
        return false;
      }
      return true;
    });

  return repaired.length === steps.length ? steps : repaired;
}

function repairRecoverableMissingSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  return repairSelectedLayeringConflicts(
    inputs,
    repairMissingEligibleManualRoutineSteps(
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
    ),
  );
}

function recoverHardSafetyViolation(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  reason: string,
): SuggestionGenerationStepOutput[] | null {
  if (reason === 'unsafe_ingredient_layering_conflict') {
    const repairedLayering = repairSelectedLayeringConflicts(inputs, steps);
    if (repairedLayering !== steps) {
      const repaired = repairRecoverableMissingSteps(inputs, repairedLayering);
      return resolveHardSafetyFallbackReason(inputs, repaired)
        ? null
        : repaired;
    }
  }
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
  if (!requiresOnDemandMoisturizerSupport(inputs)) {
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

function requiresOnDemandMoisturizerSupport(
  inputs: SuggestionGenerationInputs,
): boolean {
  return (
    inputs.requestSource === SuggestionRequestSource.OnDemand &&
    ['post_workout', 'post_sun', 'post_swim', 'post_makeup_or_shower'].includes(
      inputs.requestContext?.intent ?? '',
    )
  );
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

function repairSelectedLayeringConflicts(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionGenerationStepOutput[] {
  let repairedSteps = [...steps];
  let repaired = false;

  while (true) {
    const conflict = findSelectedLayeringConflict(inputs, repairedSteps);
    if (!conflict) break;
    const removeIndex = chooseLayeringConflictRemovalIndex(
      inputs,
      repairedSteps,
      conflict.leftIndex,
      conflict.rightIndex,
    );
    if (removeIndex === null) break;
    repairedSteps = repairedSteps.filter((_, index) => index !== removeIndex);
    repaired = true;
  }

  return repaired ? orderBaselineSteps(repairedSteps) : steps;
}

function findSelectedLayeringConflict(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): { leftIndex: number; rightIndex: number } | null {
  const scoreByProductId = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );

  for (let leftIndex = 0; leftIndex < steps.length; leftIndex += 1) {
    const leftProductId = steps[leftIndex].inventoryProductId;
    if (!leftProductId) continue;
    const leftScore = scoreByProductId.get(leftProductId);
    if (!leftScore) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < steps.length;
      rightIndex += 1
    ) {
      const rightProductId = steps[rightIndex].inventoryProductId;
      if (!rightProductId) continue;
      const rightScore = scoreByProductId.get(rightProductId);
      if (!rightScore) continue;
      if (hasAiLayeringConflict(leftScore, rightScore)) {
        return { leftIndex, rightIndex };
      }
    }
  }

  return null;
}

function chooseLayeringConflictRemovalIndex(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  leftIndex: number,
  rightIndex: number,
): number | null {
  const candidates = [leftIndex, rightIndex]
    .map((index) => ({
      index,
      step: steps[index],
      removableRank: layeringConflictRemovableRank(inputs, steps[index]),
      suitability: stepSuitability(inputs, steps[index]),
    }))
    .filter((candidate) => candidate.removableRank > 0)
    .sort((left, right) => {
      const removableDiff = right.removableRank - left.removableRank;
      if (removableDiff !== 0) return removableDiff;
      const suitabilityDiff = left.suitability - right.suitability;
      return suitabilityDiff || right.step.stepOrder - left.step.stepOrder;
    });

  return candidates[0]?.index ?? null;
}

function layeringConflictRemovableRank(
  inputs: SuggestionGenerationInputs,
  step: SuggestionGenerationStepOutput,
): number {
  if (!step.inventoryProductId) return 0;
  if (isSpecialistLockedGeneratedStep(inputs, step)) return 0;
  if (step.provenance === SuggestionStepProvenance.AiAdded) return 3;
  if (step.provenance === SuggestionStepProvenance.UserRoutine) return 2;
  return 1;
}

function isSpecialistLockedGeneratedStep(
  inputs: SuggestionGenerationInputs,
  step: SuggestionGenerationStepOutput,
): boolean {
  return inputs.routineSteps.some(
    (routineStep) =>
      routineStep.id === step.routineStepId && routineStep.is_specialist_locked,
  );
}

function stepSuitability(
  inputs: SuggestionGenerationInputs,
  step: SuggestionGenerationStepOutput,
): number {
  if (!step.inventoryProductId) return -1;
  return (
    resolveSuggestionProductScores(inputs).find(
      (score) => score.productId === step.inventoryProductId,
    )?.suitabilityScore ?? -1
  );
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
      explanation: buildProductScoreStepExplanation(score, {
        language: normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE),
        goalText: goalTextForStepExplanation(inputs),
      }),
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
    hasIngredientAnalysisLayeringConflict(left, right) ||
    hasSpecificTextLayeringConflict(left, right) ||
    hasStrongActiveAiLayeringConflict(left, right)
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

function hasStrongActiveAiLayeringConflict(
  left: SuggestionContextSummary['productScores'][number],
  right: SuggestionContextSummary['productScores'][number],
): boolean {
  return isLeaveOnStrongActiveScore(left) && isLeaveOnStrongActiveScore(right);
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

function trimOverlongAiRoutineSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  hasLockedInput: boolean,
): SuggestionGenerationStepOutput[] {
  const maxSteps = maxAiRoutineStepCount(inputs);
  if (!maxSteps || steps.length <= maxSteps) return steps;
  if (hasLockedInput || inputs.routineSteps.length > 0) return steps;
  if (
    steps.some((step) => step.provenance !== SuggestionStepProvenance.AiAdded)
  ) {
    return steps;
  }

  const scoreByProductId = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  const selectedSteps = steps.map((step) => ({
    step,
    score: step.inventoryProductId
      ? (scoreByProductId.get(step.inventoryProductId) ?? null)
      : null,
  }));
  const requiredProductIds = new Set<string>();
  addHighestScoredSelectedCategory(
    selectedSteps,
    ProductCategory.SunProtection,
    requiresOwnedDaytimeSpf(inputs),
    requiredProductIds,
  );
  addHighestScoredSelectedCategory(
    selectedSteps,
    ProductCategory.Moisturizer,
    requiresBarrierMoisturizer(inputs),
    requiredProductIds,
  );

  const ranked = [...selectedSteps].sort(
    (left, right) =>
      selectedStepTrimPriority(inputs, right.step, right.score) -
        selectedStepTrimPriority(inputs, left.step, left.score) ||
      left.step.stepOrder - right.step.stepOrder,
  );
  const keptProductIds = new Set(requiredProductIds);
  for (const candidate of ranked) {
    if (keptProductIds.size >= maxSteps) break;
    if (!candidate.step.inventoryProductId) continue;
    keptProductIds.add(candidate.step.inventoryProductId);
  }

  const trimmed = steps.filter(
    (step) =>
      step.inventoryProductId && keptProductIds.has(step.inventoryProductId),
  );
  return trimmed.length === steps.length ? steps : trimmed;
}

function maxAiRoutineStepCount(
  inputs: SuggestionGenerationInputs,
): number | null {
  if (inputs.requestSource === SuggestionRequestSource.OnDemand) {
    switch (inputs.requestContext?.intensity) {
      case 'minimal':
        return requiresOwnedDaytimeSpf(inputs) ||
          requiresOnDemandMoisturizerSupport(inputs)
          ? 3
          : 2;
      case 'standard':
      case undefined:
      case null:
        return 3;
      default:
        return null;
    }
  }

  const preferences = inputs.skinProfile?.routine_preferences;
  const availableMinutes =
    inputs.daypart === SuggestionDaypart.Morning
      ? preferences?.am_minutes
      : inputs.daypart === SuggestionDaypart.Evening
        ? preferences?.pm_minutes
        : null;
  if (typeof availableMinutes === 'number' && availableMinutes <= 10) {
    return 4;
  }
  return null;
}

function addHighestScoredSelectedCategory(
  selectedSteps: {
    step: SuggestionGenerationStepOutput;
    score: SuggestionContextSummary['productScores'][number] | null;
  }[],
  category: ProductCategory,
  required: boolean,
  requiredProductIds: Set<string>,
): void {
  if (!required) return;
  const candidate = selectedSteps
    .filter(
      (item) =>
        item.step.inventoryProductId && item.score?.category === category,
    )
    .sort(
      (left, right) =>
        (right.score?.suitabilityScore ?? 0) -
          (left.score?.suitabilityScore ?? 0) ||
        left.step.stepOrder - right.step.stepOrder,
    )[0];
  if (candidate?.step.inventoryProductId) {
    requiredProductIds.add(candidate.step.inventoryProductId);
  }
}

function selectedStepTrimPriority(
  inputs: SuggestionGenerationInputs,
  step: SuggestionGenerationStepOutput,
  score: SuggestionContextSummary['productScores'][number] | null,
): number {
  let priority = score?.suitabilityScore ?? 0;
  if (score?.category === ProductCategory.SunProtection) {
    priority += requiresOwnedDaytimeSpf(inputs) ? 1000 : -100;
  }
  if (
    score?.category === ProductCategory.Moisturizer &&
    requiresBarrierMoisturizer(inputs)
  ) {
    priority += 400;
  }
  if (
    score?.category &&
    ![
      ProductCategory.Cleanser,
      ProductCategory.Moisturizer,
      ProductCategory.SunProtection,
    ].includes(score.category)
  ) {
    priority += 20;
  }
  if (step.provenance === SuggestionStepProvenance.SpecialistLocked) {
    priority += 10_000;
  }
  return priority;
}

function normalizeExplanationForSelectedSteps(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
  explanation: SuggestionExplanationJson,
): SuggestionExplanationJson {
  const selectedProductLabels = selectedProductLabelsForSteps(steps);
  const perStepReasons = steps.map((step) => ({
    stepOrder: step.stepOrder,
    reason: step.explanation ?? fallbackStepExplanation(inputs, step),
  }));
  const body = [
    ...explanation.body.filter(
      (line) =>
        !isConditionalSelectedSpfText(steps, line) &&
        !isOffSlotSunscreenCopy(inputs, line) &&
        !isSelectedStepSkippedCopy(steps, selectedProductLabels, line) &&
        !isUnselectedStrongActiveCopy(inputs, selectedProductLabels, line),
    ),
    ...deterministicExplanationBodyLines(inputs, explanation.body),
  ];
  const skipped = mergeSkippedExplanationItems(
    filterExactSkippedExplanationItems(inputs, explanation.skipped).filter(
      (skipped) => {
        const normalizedName = normalizeProductCopy(skipped.name);
        return ![...selectedProductLabels].some(
          (selected) =>
            selected.length > 0 &&
            (normalizedName.includes(selected) ||
              selected.includes(normalizedName)),
        );
      },
    ),
    deterministicSkippedExplanationItems(inputs, selectedProductLabels),
  );

  return {
    ...explanation,
    headline:
      isSelectedStepSkippedCopy(
        steps,
        selectedProductLabels,
        explanation.headline,
      ) ||
      isUnselectedStrongActiveCopy(
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

function filterExactSkippedExplanationItems(
  inputs: SuggestionGenerationInputs,
  skippedItems: SuggestionExplanationJson['skipped'],
): SuggestionExplanationJson['skipped'] {
  const allowedNames = allowedSkippedExplanationNames(inputs);
  return skippedItems.filter((skipped) =>
    allowedNames.has(normalizeProductCopy(skipped.name)),
  );
}

function allowedSkippedExplanationNames(
  inputs: SuggestionGenerationInputs,
): Set<string> {
  const allowed = new Set<string>();
  for (const product of inputs.shelfActiveProducts) {
    addAllowedSkippedExplanationName(allowed, product.id);
    addAllowedSkippedExplanationName(allowed, product.name);
    addAllowedSkippedExplanationName(
      allowed,
      [product.brand, product.name].filter(Boolean).join(' '),
    );
    addAllowedSkippedExplanationName(allowed, product.category);
  }
  for (const score of inputs.contextSummary.productScores) {
    addAllowedSkippedExplanationName(allowed, score.productId);
    addAllowedSkippedExplanationName(allowed, score.name);
    addAllowedSkippedExplanationName(
      allowed,
      [score.brand, score.name].filter(Boolean).join(' '),
    );
    addAllowedSkippedExplanationName(allowed, score.category);
  }
  for (const category of Object.values(ProductCategory)) {
    addAllowedSkippedExplanationName(allowed, category);
    addAllowedSkippedExplanationName(allowed, category.replace(/-/g, ' '));
  }
  return allowed;
}

function addAllowedSkippedExplanationName(
  allowed: Set<string>,
  value: string | null,
): void {
  if (!value?.trim()) return;
  allowed.add(normalizeProductCopy(value));
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
        !isRawReactionHistoryExplanationInput(input) &&
        !isSelectedStepSkippedCopy([], selectedProductLabels, input.detail) &&
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
      (!isSelectedStepSkippedCopy(
        steps,
        selectedProductLabels,
        step.explanation,
      ) &&
        !isUnselectedStrongActiveCopy(
          inputs,
          selectedProductLabels,
          step.explanation,
        ))
    ) {
      return step;
    }
    return {
      ...step,
      explanation: fallbackStepExplanation(inputs, step),
    };
  });
}

function isSelectedStepSkippedCopy(
  steps: SuggestionGenerationStepOutput[],
  selectedProductLabels: Set<string>,
  line: string,
): boolean {
  const normalizedLine = normalizeProductCopy(line);
  if (!normalizedLine || !hasSkipIntent(normalizedLine)) return false;
  const labels = [...selectedProductLabels, ...selectedStepLabels(steps)];
  return labels.some(
    (label) =>
      label.length >= 3 &&
      (normalizedLine.includes(label) || label.includes(normalizedLine)),
  );
}

function selectedStepLabels(steps: SuggestionGenerationStepOutput[]): string[] {
  return steps
    .flatMap((step) => [step.stepLabel, step.customLabel])
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => normalizeProductCopy(value));
}

function hasSkipIntent(normalizedLine: string): boolean {
  return /\b(skip|skipped|omit|omitted|pause|paused|hold|held|leave out|left out|not use)\b/.test(
    normalizedLine,
  );
}

function fallbackStepExplanation(
  inputs: SuggestionGenerationInputs,
  step: SuggestionGenerationStepOutput,
): string {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  const score = step.inventoryProductId
    ? resolveSuggestionProductScores(inputs).find(
        (productScore) => productScore.productId === step.inventoryProductId,
      )
    : null;
  return score
    ? buildProductScoreStepExplanation(score, {
        language,
        goalText: goalTextForStepExplanation(inputs),
      })
    : buildCategoryStepExplanation(step.stepLabel, language);
}

function goalTextForStepExplanation(
  inputs: SuggestionGenerationInputs,
): string | null {
  return (
    inputs.contextSummary.goalSignals?.mainGoal ??
    inputs.contextSummary.goalSignals?.primaryGoal ??
    inputs.skinProfile?.primary_goal ??
    inputs.contextSummary.skinProfile.primaryGoal ??
    null
  );
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
    .filter(
      (part) =>
        part.length > 0 &&
        !isSensitiveProfileClaim(part) &&
        !isStandaloneSensitiveProfileValue(part),
    )
    .join('; ')
    .replace(
      /\b(ethnicity|race|countryCode|country|city|location|skinTone|skin_tone|skin tone|tone|fitzpatrick(?:Phototype)?|phototype)\s*[:=]\s*[^,;]+,?\s*/gi,
      '',
    )
    .replace(
      /\b(?:fitzpatrick(?:\s*phototype)?|phototype)\s*(?:type\s*)?(?:I{1,3}|IV|V|VI|[1-6])\b,?\s*/gi,
      '',
    )
    .replace(
      /(^|[,;]\s*)(?:black|white|asian|hispanic|latino|latina|mixed|deep|fair|light|medium|dark|olive|brown)(?=\s*(?:[,;]|$))/gi,
      '$1',
    )
    .replace(/\s*;\s*;/g, ';')
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;\s]+|[,;\s]+$/g, '')
    .trim();
}

function isSensitiveProfileClaim(value: string): boolean {
  return /^(?:ethnicity|race|countryCode|country|city|location|skinTone|skin_tone|skin tone|tone|fitzpatrick(?:Phototype)?|phototype)\s*[:=]/i.test(
    value,
  );
}

function isStandaloneSensitiveProfileValue(value: string): boolean {
  return /^(?:black|white|asian|hispanic|latino|latina|mixed|deep|fair|light|medium|dark|olive|brown|fitzpatrick\s*(?:phototype)?\s*(?:type\s*)?(?:I{1,3}|IV|V|VI|[1-6])|phototype\s*(?:I{1,3}|IV|V|VI|[1-6]))$/i.test(
    value.trim(),
  );
}

function isSensitiveExplanationInputLabel(label: string): boolean {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return [
    'ethnicity',
    'race',
    'skintone',
    'tone',
    'country',
    'countrycode',
    'city',
    'location',
    'fitzpatrick',
    'fitzpatrickphototype',
    'phototype',
  ].includes(normalized);
}

function isRawReactionHistoryExplanationInput(
  input: SuggestionExplanationJson['inputs'][number],
): boolean {
  const normalizedLabel = input.label.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const text = `${input.label} ${input.detail}`;
  return (
    normalizedLabel.includes('reactionhistory') ||
    /\breaction\s*history\b/i.test(text) ||
    /\bseverity\s*[:=]?\s*(mild|moderate|severe)\b/i.test(text) ||
    /\s(?:→|->|>)\s/.test(text)
  );
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
      .filter((product) => {
        if (!product.productId || !product.lastAppliedDate) return false;
        const score = scoreByProductId.get(product.productId);
        return score ? isLeaveOnStrongActiveScore(score) : false;
      })
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
  if (hasSelectedLayeringConflict(inputs, steps)) {
    return 'unsafe_ingredient_layering_conflict';
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

function hasSelectedLayeringConflict(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): boolean {
  const selectedScoresValue = selectedProductScores(inputs, steps);
  for (
    let leftIndex = 0;
    leftIndex < selectedScoresValue.length;
    leftIndex += 1
  ) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < selectedScoresValue.length;
      rightIndex += 1
    ) {
      if (
        hasAiLayeringConflict(
          selectedScoresValue[leftIndex],
          selectedScoresValue[rightIndex],
        )
      ) {
        return true;
      }
    }
  }
  return false;
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
  return normalizeGapRecommendationCopy(inputs, merged);
}

const SUNSCREEN_GAP_CATEGORY: Record<AppLanguage, string> = {
  en: 'Broad-spectrum sunscreen SPF 30+',
  sv: 'Brett spektrum solskydd SPF 30+',
  es: 'Protector solar de amplio espectro SPF 30+',
};

function normalizeGapRecommendationCopy(
  inputs: SuggestionGenerationInputs,
  gaps: SuggestionGapRecommendationJson[],
): SuggestionGapRecommendationJson[] {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  return gaps.map((gap) =>
    isSunscreenGap(gap)
      ? {
          ...gap,
          ingredientOrCategory: SUNSCREEN_GAP_CATEGORY[language],
        }
      : gap,
  );
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
