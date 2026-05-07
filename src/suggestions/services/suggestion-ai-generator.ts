import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFeatureOpenAiModel } from '../../common/utils/openai-config';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
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

export const SUGGESTION_AI_MODEL_ENV_KEY = 'SUGGESTION_AI_MODEL';
export const SUGGESTION_AI_TIMEOUT_MS = 45_000;
export const SUGGESTION_AI_MAX_OUTPUT_TOKENS = 1500;

export interface SuggestionGenerationInputs {
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
      );
    }

    if (isAllSpecialistLocked(inputs) || !apiKey || !model) {
      return this.buildBaseline(inputs, startedAt, 'deterministic-baseline');
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
        );
      }
      steps.push(resolved);
    }

    const hasReactionSignal = hasReactionSignalInInputs(inputs);
    return {
      mode: computeMode(steps, context.lockedSteps.length > 0),
      hasReactionSignal,
      simplifiedForReaction:
        Boolean(raw.simplifiedForReaction) && hasReactionSignal,
      explanation: sanitizeExplanation(raw.explanation ?? defaultExplanation()),
      gapRecommendations: sanitizeGapRecommendations(
        raw.gapRecommendations ?? [],
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
  ): SuggestionGenerationOutput {
    const orderedSteps = [...inputs.routineSteps].sort(
      (a, b) => a.step_order - b.step_order,
    );
    const steps =
      orderedSteps.length > 0
        ? orderedSteps.map((step, index) => routineStepToOutput(step, index))
        : buildDeterministicAiSteps(inputs);
    const hasReactionSignal = hasReactionSignalInInputs(inputs);
    return {
      mode:
        orderedSteps.length === 0 ? SuggestionMode.Ai : SuggestionMode.Manual,
      hasReactionSignal,
      simplifiedForReaction: hasReactionSignal && orderedSteps.length === 0,
      explanation:
        orderedSteps.length === 0
          ? deterministicExplanation(inputs, steps)
          : defaultExplanation(),
      gapRecommendations: buildDeterministicGapRecommendations(inputs),
      safetyFlags: buildDeterministicSafetyFlags(inputs, steps),
      steps,
      metadata: {
        model,
        promptVersion: SUGGESTION_PROMPT_VERSION,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostUsd: null,
        durationMs: Date.now() - startedAt,
      },
    };
  }
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
