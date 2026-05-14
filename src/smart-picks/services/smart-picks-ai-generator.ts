import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFeatureOpenAiModel } from '../../common/utils/openai-config';
import { openAiRepeatabilityRequestOptions } from '../../common/utils/openai-request-options';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { mergeEvidenceSourceIds } from '../../suggestions/services/suggestion-evidence-sources';
import { normalizeSuggestionGapKey } from '../../suggestions/services/suggestion-gap-actions';
import {
  SmartPicksBudgetTier,
  SmartPicksCoverage,
  SmartPicksCoverageRole,
  SmartPicksCoverageSlot,
  SmartPicksCoverageState,
  SmartPicksGapSnapshot,
  SmartPicksGoalRelevance,
  SmartPicksGapKind,
  SmartPicksProductPerformanceSummary,
  SmartPicksProductPerformanceSignal,
  SmartPicksProductPick,
  SmartPicksReasoningChip,
  SmartPicksRuledOutProduct,
} from '../smart-picks.types';
import { SMART_PICKS_COVERAGE_ROLES } from './smart-picks-localization';
import { SmartPicksContext } from './smart-picks-context-builder';

export const SMART_PICKS_AI_MODEL_ENV_KEY = 'SMART_PICKS_AI_MODEL';
const SMART_PICKS_AI_TIMEOUT_MS = 120_000;
const SMART_PICKS_AI_MAX_OUTPUT_TOKENS = 6000;
const SOURCE_ID_ENUM = Object.values(SuggestionEvidenceSourceId);
const SMART_PICKS_STARTER_TREATMENT_CONFIDENCES = [
  'low',
  'medium',
  'high',
] as const;

export const SmartPicksAiProviderSkippedReason = {
  MissingApiKey: 'missing_api_key',
  NoGaps: 'no_gaps',
} as const;

export type SmartPicksAiProviderSkippedReason =
  (typeof SmartPicksAiProviderSkippedReason)[keyof typeof SmartPicksAiProviderSkippedReason];

export type SmartPicksAiGenerationDiagnostics = {
  requestedGapCount: number;
  rawGapCount: number;
  acceptedPickCount: number;
  blockedOwnedCount: number;
  blockedBudgetCount: number;
  blockedSafetyCount: number;
  invalidPickCount: number;
  missingPickCount: number;
  providerFailed: boolean;
  providerSkippedReason: SmartPicksAiProviderSkippedReason | null;
};

type RawSmartPickResponse = {
  gaps?: RawSmartPickGap[];
};

type RawSmartPicksPlanResponse = {
  coverage?: {
    slots?: RawSmartPicksCoverageSlot[];
  };
  gaps?: RawSmartPicksPlanGap[];
};

type RawSmartPicksCoverageSlot = {
  role?: string;
  state?: string;
  filledByProductId?: string | null;
  goalRelevance?: string;
};

type RawSmartPicksPlanGap = {
  ingredientOrCategory?: string;
  priority?: string;
  reason?: string;
  shortReason?: string | null;
  goalAlignment?: string | null;
  sourceIds?: SuggestionEvidenceSourceId[];
  gapKind?: string | null;
  replacementForProductId?: string | null;
};

type RawSmartPickGap = {
  normalizedKey?: string;
  brand?: string;
  productName?: string;
  budgetTier?: SmartPicksBudgetTier | null;
  recommendationRankReason?: string | null;
  sellerNames?: string[];
  reasoningChips?: SmartPicksReasoningChip[];
  reasoningFacts?: RawReasoningFacts;
  ruledOut?: SmartPicksRuledOutProduct[];
  alternatives?: RawSmartPickAlternative[];
  sourceIds?: SuggestionEvidenceSourceId[];
};

type RawSmartPickAlternative = Omit<RawSmartPickGap, 'normalizedKey'>;

type RawReasoningFacts =
  | Record<string, string>
  | { label?: string; value?: string }[];

type RawStarterTreatmentAssessment = {
  shouldRecommend?: boolean;
  ingredientOrCategory?: string | null;
  goalAlignment?: string | null;
  reason?: string | null;
  sourceIds?: SuggestionEvidenceSourceId[];
  confidence?: string | null;
};

export type GeneratedSmartPick = Omit<
  SmartPicksProductPick,
  'id' | 'userAction' | 'createdAt' | 'alternatives'
> & {
  alternatives: GeneratedSmartPickAlternative[];
};

type GeneratedSmartPickAlternative = Omit<
  SmartPicksProductPick,
  'id' | 'userAction' | 'createdAt' | 'alternatives'
> & {
  alternatives: GeneratedSmartPickAlternative[];
};

type SmartPicksStarterTreatmentConfidence =
  (typeof SMART_PICKS_STARTER_TREATMENT_CONFIDENCES)[number];

export type SmartPicksStarterTreatmentAssessment = {
  shouldRecommend: boolean;
  ingredientOrCategory: string | null;
  goalAlignment: string | null;
  reason: string;
  sourceIds: SuggestionEvidenceSourceId[];
  confidence: SmartPicksStarterTreatmentConfidence;
};

export type SmartPicksAiGenerationResult = {
  picks: Map<string, GeneratedSmartPick>;
  diagnostics: SmartPicksAiGenerationDiagnostics;
};

export type SmartPicksAiPlanResult = {
  coverage: SmartPicksCoverage;
  priorityGaps: SmartPicksGapSnapshot[];
  considerGaps: SmartPicksGapSnapshot[];
};

export type SmartPicksAiPlanDiagnostics = {
  rawCoverageSlotCount: number;
  acceptedCoverageSlotCount: number;
  invalidCoverageSlotCount: number;
  rawGapCount: number;
  acceptedGapCount: number;
  acceptedPriorityGapCount: number;
  acceptedConsiderGapCount: number;
  invalidGapCount: number;
  blockedOwnedGapCount: number;
  blockedSafetyGapCount: number;
  blockedPregnancySafetyGapCount: number;
  blockedReplacementEvidenceGapCount: number;
  providerFailed: boolean;
  providerSkippedReason: SmartPicksAiProviderSkippedReason | null;
  missingPlan: boolean;
};

export type SmartPicksAiPlanGenerationResult = {
  plan: SmartPicksAiPlanResult | null;
  diagnostics: SmartPicksAiPlanDiagnostics;
};

type SanitizePickBlockReason = 'invalid' | 'owned' | 'budget' | 'safety';

type SanitizePickResult = {
  pick: GeneratedSmartPick | null;
  blockReason: SanitizePickBlockReason | null;
};

@Injectable()
export class SmartPicksAiGenerator {
  private readonly logger = new Logger(SmartPicksAiGenerator.name);

  constructor(private readonly configService: ConfigService) {}

  async generatePlan(
    context: SmartPicksContext,
  ): Promise<SmartPicksAiPlanResult | null> {
    return (await this.generatePlanWithDiagnostics(context)).plan;
  }

  async generatePlanWithDiagnostics(
    context: SmartPicksContext,
  ): Promise<SmartPicksAiPlanGenerationResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const model =
      readFeatureOpenAiModel(
        this.configService,
        SMART_PICKS_AI_MODEL_ENV_KEY,
        'gpt-4.1-mini',
      ) ?? 'gpt-4.1-mini';
    if (!apiKey || !model) {
      return {
        plan: null,
        diagnostics: {
          ...basePlanDiagnostics(),
          missingPlan: true,
          providerSkippedReason:
            SmartPicksAiProviderSkippedReason.MissingApiKey,
        },
      };
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
              content: [{ type: 'input_text', text: PLAN_SYSTEM_PROMPT }],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: buildPlanPrompt(context),
                },
              ],
            },
          ],
          max_output_tokens: 4500,
          ...openAiRepeatabilityRequestOptions(model),
          text: {
            verbosity: 'low',
            format: PLAN_RESPONSE_FORMAT,
          },
        }),
        signal: AbortSignal.timeout(SMART_PICKS_AI_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(await openAiErrorMessage(response, 'coverage plan'));
      }

      const payload = (await response.json()) as {
        output?: { content?: { type: string; text?: string }[] }[];
      };
      const rawText = extractOutputText(payload);
      if (!rawText) {
        return {
          plan: null,
          diagnostics: { ...basePlanDiagnostics(), missingPlan: true },
        };
      }
      const parsed = JSON.parse(rawText) as RawSmartPicksPlanResponse;
      return sanitizeSmartPicksPlan(context, parsed);
    } catch (error) {
      this.logger.warn(
        `Smart Picks AI plan failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return {
        plan: null,
        diagnostics: {
          ...basePlanDiagnostics(),
          providerFailed: true,
          missingPlan: true,
        },
      };
    }
  }

  async assessStarterTreatment(
    context: SmartPicksContext,
  ): Promise<SmartPicksStarterTreatmentAssessment | null> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const model =
      readFeatureOpenAiModel(
        this.configService,
        SMART_PICKS_AI_MODEL_ENV_KEY,
        'gpt-4.1-mini',
      ) ?? 'gpt-4.1-mini';
    if (!apiKey || !model) {
      return null;
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
              content: [
                {
                  type: 'input_text',
                  text: STARTER_TREATMENT_SYSTEM_PROMPT,
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: buildStarterTreatmentPrompt(context),
                },
              ],
            },
          ],
          max_output_tokens: 650,
          ...openAiRepeatabilityRequestOptions(model),
          text: {
            verbosity: 'low',
            format: STARTER_TREATMENT_RESPONSE_FORMAT,
          },
        }),
        signal: AbortSignal.timeout(SMART_PICKS_AI_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          await openAiErrorMessage(response, 'starter treatment'),
        );
      }

      const payload = (await response.json()) as {
        output?: { content?: { type: string; text?: string }[] }[];
      };
      const rawText = extractOutputText(payload);
      if (!rawText) return null;
      const parsed = JSON.parse(rawText) as RawStarterTreatmentAssessment;
      return sanitizeStarterTreatmentAssessment(context, parsed);
    } catch (error) {
      this.logger.warn(
        `Smart Picks starter treatment assessment failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  async generate(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
  ): Promise<Map<string, GeneratedSmartPick>> {
    return (await this.generateWithDiagnostics(context, gaps)).picks;
  }

  async generateWithDiagnostics(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
  ): Promise<SmartPicksAiGenerationResult> {
    if (gaps.length === 0) {
      return emptyGenerationResult(
        gaps.length,
        SmartPicksAiProviderSkippedReason.NoGaps,
      );
    }
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const model =
      readFeatureOpenAiModel(
        this.configService,
        SMART_PICKS_AI_MODEL_ENV_KEY,
        'gpt-4.1-mini',
      ) ?? 'gpt-4.1-mini';
    if (!apiKey || !model) {
      return emptyGenerationResult(
        gaps.length,
        SmartPicksAiProviderSkippedReason.MissingApiKey,
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
              content: [
                {
                  type: 'input_text',
                  text: buildPrompt(context, gaps),
                },
              ],
            },
          ],
          max_output_tokens: SMART_PICKS_AI_MAX_OUTPUT_TOKENS,
          ...openAiRepeatabilityRequestOptions(model),
          text: {
            verbosity: 'low',
            format: RESPONSE_FORMAT,
          },
        }),
        signal: AbortSignal.timeout(SMART_PICKS_AI_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(await openAiErrorMessage(response, 'product picks'));
      }

      const payload = (await response.json()) as {
        output?: { content?: { type: string; text?: string }[] }[];
      };
      const rawText = extractOutputText(payload);
      if (!rawText) return failedGenerationResult(gaps.length);
      const parsed = JSON.parse(rawText) as RawSmartPickResponse;
      return sanitizeGeneratedPicks(context, gaps, parsed);
    } catch (error) {
      this.logger.warn(
        `Smart Picks AI generation failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return failedGenerationResult(gaps.length);
    }
  }
}

const STARTER_TREATMENT_SYSTEM_PROMPT = [
  "You are Ritora's dermatologist-informed starter-kit treatment assessor.",
  'The starter essentials are cleanser, moisturizer, and sunscreen. A treatment belongs only when the profile goal, concern details, tolerance, history, and safety context justify it.',
  'Use conservative, evidence-aware skincare reasoning, but do not claim to diagnose, prescribe, or replace a licensed dermatologist.',
  'Recommend treatment only when it is clearly tied to the user goal, and wait when the user only wants a basic routine.',
  'Return a product type or key ingredient category, not a brand or exact product.',
  'Never diagnose, treat, cure, or prescribe. Photo and journal trends are only decision support.',
  'Respect disliked ingredients, known reaction triggers, active tolerances, pregnancy status, prescribed-active overlap, and dermatologist-care context.',
  'Reasoning about skin tone must be concrete and cautious: use phrases such as PIH-aware, white-cast checked, low-irritation intro, or tint/finish checked. Do not say trusted on an ethnicity or suited to a race.',
  'Return strictly valid JSON matching the schema.',
].join(' ');

const PLAN_SYSTEM_PROMPT = [
  "You are Ritora's AI-first Smart Picks coverage and gap analyst.",
  'Decide what the user actually needs from their skin profile, shelf, product history, photo trend summaries, safety context, budget, environment, and stated goals.',
  'Coverage and gaps must be generated by AI reasoning from the full context, not by fixed product-category templates.',
  'Use conservative, evidence-aware skincare reasoning similar to how a careful skincare professional would evaluate a routine, but do not claim to diagnose, prescribe, or replace a licensed dermatologist.',
  'Ritora helps users buy smarter, not more: include only real gaps, justified replacement needs, or optional lanes worth considering.',
  'Photo and journal trends are decision support, not clinical proof.',
  'Never recommend or imply need for ingredients the user dislikes, cannot tolerate, has reacted to, or should avoid from pregnancy/safety context.',
  'Never mark an unowned product as filled in coverage. Filled coverage must reference an active shelf product id from the prompt.',
  'Starter Kit must also be AI-decided: choose the essential first routine steps for this exact user, not a generic fixed kit.',
  'Return strictly valid JSON matching the schema.',
].join(' ');

const SYSTEM_PROMPT = [
  "You are Ritora's dermatologist-informed skincare product suggestion engine.",
  'Ritora helps users buy smarter, not more: recommend a product only when a real shelf gap, justified replacement need, or worth-considering support lane exists.',
  'Use conservative, evidence-aware skincare reasoning similar to how a careful skincare professional would evaluate a routine, but do not claim to diagnose, prescribe, or replace a licensed dermatologist.',
  'Return product names and fit reasoning only. Do not return purchase links, live prices, affiliate information, or seller verification claims.',
  'You may include up to three reputable seller names to check, but they are only starting points for the user to compare themselves.',
  'Best-fit-first: rank product fit by the user goal, budget, skin profile, history, safety context, and shelf compatibility.',
  'Do not choose a weaker product only because it is local, and do not choose or reject a product because of country of origin alone.',
  'Korean, Japanese, Canadian, Australian, European, American, and local products are all valid when the formulation is the best fit.',
  'You may use broad product reputation, repeated user reports, independent reviews, and well-known category performance as weak supporting signals.',
  'Do not invent review counts, clinical claims, or guaranteed results, and never let reputation override safety, pregnancy context, reaction history, dermatologist care, or the user-specific gap.',
  'Never diagnose, treat, cure, or prescribe. Use cautious skincare-app wording.',
  'If the user is under dermatologist care, do not replace or contradict that care; prefer supportive over-the-counter products and flag possible overlap with prescribed actives cautiously.',
  'Reasoning about skin tone must be concrete and cautious: use phrases such as PIH-aware, white-cast checked, low-irritation intro, or tint/finish checked. Do not say trusted on an ethnicity or suited to a race.',
  'Never recommend products matching owned products, disliked ingredients, disliked brands, or known reaction triggers supplied by the user.',
  'Return strictly valid JSON matching the schema.',
].join(' ');

const GOAL_SPECIFIC_PICK_GUIDANCE = [
  'Goal-specific pick guidance:',
  '- dark marks or hyperpigmentation: prioritize pigment-supporting products such as azelaic acid, tranexamic acid, vitamin C/ascorbic derivatives, kojic acid, alpha arbutin, a gentle pigment-supporting mask/peel, or a beginner retinoid when the safety context allows; do not satisfy this gap with a generic glow moisturizer.',
  '- breakouts or clogged pores: choose the concrete lane requested by the gap, such as adapalene/benzoyl peroxide, azelaic acid, salicylic acid/BHA, barrier support, or a clay/sulfur mask; do not collapse every gap into one generic treatment.',
  '- rough texture or clogged pores: choose the requested lane, such as gentle AHA/PHA/BHA support, a retinoid when safe, barrier support, or an occasional smoothing mask/peel.',
  '- redness, sensitivity, or barrier repair: prioritize the requested calming lane, such as niacinamide, panthenol, centella, bland barrier-support products, recovery balm/mask, or sensitive-skin sunscreen; avoid exfoliating acids unless the profile clearly tolerates them.',
  '- hydration: choose the requested lane, such as humectant serum, barrier-support moisturizer, or occasional overnight hydration mask.',
  '- fine lines or firmness: choose the requested lane, such as a gentle retinoid/retinal night product when safe, peptide support, antioxidant support, or barrier support for active nights.',
].join('\n');

const PLAN_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'smart_picks_plan_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['coverage', 'gaps'],
    properties: {
      coverage: {
        type: 'object',
        additionalProperties: false,
        required: ['slots'],
        properties: {
          slots: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['role', 'state', 'filledByProductId', 'goalRelevance'],
              properties: {
                role: {
                  type: 'string',
                  enum: SMART_PICKS_COVERAGE_ROLES,
                },
                state: {
                  type: 'string',
                  enum: ['filled', 'missing', 'missing-priority'],
                },
                filledByProductId: { type: ['string', 'null'] },
                goalRelevance: {
                  type: 'string',
                  enum: ['essential', 'supportive', 'optional'],
                },
              },
            },
          },
        },
      },
      gaps: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'ingredientOrCategory',
            'priority',
            'reason',
            'shortReason',
            'goalAlignment',
            'sourceIds',
            'gapKind',
            'replacementForProductId',
          ],
          properties: {
            ingredientOrCategory: { type: 'string' },
            priority: { type: 'string', enum: ['priority', 'consider'] },
            reason: { type: 'string' },
            shortReason: { type: ['string', 'null'] },
            goalAlignment: { type: ['string', 'null'] },
            sourceIds: sourceIdArraySchema(),
            gapKind: {
              type: 'string',
              enum: Object.values(SmartPicksGapKind),
            },
            replacementForProductId: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
} as const;

const RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'smart_picks_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['gaps'],
    properties: {
      gaps: {
        type: 'array',
        maxItems: 7,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'normalizedKey',
            'brand',
            'productName',
            'budgetTier',
            'recommendationRankReason',
            'sellerNames',
            'reasoningChips',
            'reasoningFacts',
            'ruledOut',
            'alternatives',
            'sourceIds',
          ],
          properties: {
            normalizedKey: { type: 'string' },
            brand: { type: 'string' },
            productName: { type: 'string' },
            budgetTier: {
              type: ['string', 'null'],
              enum: ['drugstore', 'mid', 'premium', 'luxury', null],
            },
            recommendationRankReason: { type: ['string', 'null'] },
            sellerNames: sellerNameArraySchema(),
            reasoningChips: reasoningChipArraySchema(),
            reasoningFacts: {
              type: 'array',
              maxItems: 8,
              items: reasoningFactSchema(),
            },
            ruledOut: ruledOutArraySchema(),
            alternatives: {
              type: 'array',
              maxItems: 2,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'brand',
                  'productName',
                  'budgetTier',
                  'recommendationRankReason',
                  'sellerNames',
                  'reasoningChips',
                  'reasoningFacts',
                  'ruledOut',
                  'sourceIds',
                ],
                properties: {
                  brand: { type: 'string' },
                  productName: { type: 'string' },
                  budgetTier: {
                    type: ['string', 'null'],
                    enum: ['drugstore', 'mid', 'premium', 'luxury', null],
                  },
                  recommendationRankReason: { type: ['string', 'null'] },
                  sellerNames: sellerNameArraySchema(),
                  reasoningChips: reasoningChipArraySchema(),
                  reasoningFacts: {
                    type: 'array',
                    maxItems: 8,
                    items: reasoningFactSchema(),
                  },
                  ruledOut: ruledOutArraySchema(),
                  sourceIds: sourceIdArraySchema(),
                },
              },
            },
            sourceIds: sourceIdArraySchema(),
          },
        },
      },
    },
  },
} as const;

const STARTER_TREATMENT_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'smart_picks_starter_treatment_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'shouldRecommend',
      'ingredientOrCategory',
      'goalAlignment',
      'reason',
      'sourceIds',
      'confidence',
    ],
    properties: {
      shouldRecommend: { type: 'boolean' },
      ingredientOrCategory: { type: ['string', 'null'] },
      goalAlignment: { type: ['string', 'null'] },
      reason: { type: 'string' },
      sourceIds: sourceIdArraySchema(),
      confidence: {
        type: 'string',
        enum: SMART_PICKS_STARTER_TREATMENT_CONFIDENCES,
      },
    },
  },
} as const;

function sellerNameArraySchema() {
  return {
    type: 'array',
    maxItems: 3,
    items: { type: 'string' },
  } as const;
}

function reasoningChipArraySchema() {
  return {
    type: 'array',
    maxItems: 4,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['tone', 'text', 'icon'],
      properties: {
        tone: {
          type: 'string',
          enum: [
            'goal',
            'budget',
            'ethnicity',
            'compatibility',
            'location',
            'safety',
          ],
        },
        text: { type: 'string' },
        icon: { type: 'string' },
      },
    },
  } as const;
}

function ruledOutArraySchema() {
  return {
    type: 'array',
    maxItems: 4,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['brand', 'productName', 'reason'],
      properties: {
        brand: { type: 'string' },
        productName: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  } as const;
}

function reasoningFactSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'value'],
    properties: {
      label: { type: 'string' },
      value: { type: 'string' },
    },
  } as const;
}

function sourceIdArraySchema() {
  return {
    type: 'array',
    items: { type: 'string', enum: SOURCE_ID_ENUM },
  } as const;
}

function buildPlanPrompt(context: SmartPicksContext): string {
  const profile = context.skinProfile;
  return [
    'Decide the coverage meter and purchase gaps from the full context. Do not simply follow a fixed template.',
    `Mode: ${context.mode}. Budget tier: ${context.budgetTier ?? 'unset'}.`,
    `Location: city=${profile?.city ?? '?'}, country=${profile?.country_code ?? '?'}.`,
    `Skin profile: type=${profile?.skin_type ?? '?'}, tone=${profile?.skin_tone ?? '?'}, fitzpatrick=${profile?.fitzpatrick_phototype ?? '?'}, ethnicity=${profile?.ethnicity ?? '?'}.`,
    `Goal and concerns: primaryGoal=${profile?.primary_goal ?? '?'}, concerns=${(profile?.current_concerns ?? []).join(', ') || 'none'}, concernDetails=${JSON.stringify(profile?.concern_details ?? null)}.`,
    `Skin behavior and routine preference: ${JSON.stringify({
      behavior: profile?.skin_behavior ?? {},
      routine: profile?.routine_preferences ?? {},
      lifestyle: profile?.lifestyle_context ?? {},
    })}`,
    `Environment: ${JSON.stringify(context.environment ?? null)}`,
    `Safety and preferences: ${JSON.stringify(buildSafetyAndPreferenceSummary(context))}`,
    `Active shelf products that may fill coverage:\n${context.activeProducts.map(formatProductWithId).join('\n') || '(none)'}`,
    `All shelf products to avoid recommending again:\n${context.allProducts.map(formatProductWithId).join('\n') || '(none)'}`,
    `Product performance summary:\n${formatProductPerformance(context)}`,
    'Photo and journal trends are already summarized above. Use them to decide whether a replacement gap is justified, but do not imply clinical proof.',
    `Allowed coverage roles: ${SMART_PICKS_COVERAGE_ROLES.join(', ')}.`,
    'Coverage instructions: choose only roles needed for this user goal and shelf. Do not force every user into the same number of slots. Mark filled only when one active shelf product id clearly fills the role. Use missing-priority for essential missing roles, missing for optional/supportive roles.',
    'Do not add generic hydration, eye, or nice-to-have coverage just to fill space. Optional coverage should still support the stated goal, history signal, safety need, climate need, or routine tolerance.',
    'Prefer specific coverage roles over goal-primary, goal-support, or treatment-secondary whenever an allowed specific role fits the user need.',
    'Use goal-primary and goal-support only when no specific allowed role describes the need. Do not use them for pigment, breakout, texture, barrier, hydration, sunscreen, cleanser, moisturizer, antioxidant, retinoid, peptide, or mask lanes.',
    'Gap instructions: generate concrete product lanes or ingredient/category lanes that the user should buy or consider. Priority gaps should be genuinely important now. Worth-considering gaps should be useful but not essential.',
    'Worth-considering lanes still need concrete product categories. Do not omit them just because the essentials already exist when the profile, history, budget, and safety context show a useful secondary support lane.',
    'For premium or luxury budgets, include two worth-considering lanes when two safe, useful supports exist; return fewer only when the likely supports are already owned, unsafe, disliked, or genuinely irrelevant. For drugstore/basic budgets, keep optional lanes tighter and only include high-value support.',
    'For starter mode with no active products and a real goal beyond basic maintenance, aim for four priority essentials or goal steps plus two worth-considering supports when safe.',
    'Use the goal examples as examples, not a closed list: pigment/tone goals may need a targeted pigment serum, antioxidant, gentle peel/mask, or retinoid when safe; blemish or congestion goals may need an acne treatment, BHA, barrier support, or congestion mask; texture or aging goals may need retinoid, peptide, exfoliation, antioxidant, or recovery support; hydration or barrier goals may need humectant, moisturizer, calming serum, recovery mask, or sunscreen fit support. For pigment or uneven-tone goals, an antioxidant serum should usually be considered before more niche optional steps unless already owned, unsafe, or disliked.',
    'Starter mode instructions: choose the starter routine this exact user should begin with. Include cleanser/moisturizer/SPF only when they fit the profile and shelf; include treatment only when justified by the goal, safety context, tolerance, history, and photos.',
    'When a starter user has no active products, cleanser, moisturizer, and sunscreen are priority gaps unless the profile clearly says one is unsuitable. Additional goal treatments or optional supports should not push these basics into worth-considering.',
    'Refine mode instructions: evaluate what the shelf already covers, what is redundant, and what should be changed based on use/photo history before suggesting new purchases.',
    'Replacement instructions: use gapKind=replacement and replacementForProductId only when use logs plus photo/history summaries justify considering a replacement.',
    'Never include a gap for a product the user already owns, a disliked brand/product/ingredient, a known reaction trigger, or an unsafe active for pregnancy/safety context.',
    'Use sourceIds from the available evidence enum only. Keep reasons short, human, and specific to the user.',
    'Return no more than 4 priority gaps in starter mode, 3 priority gaps in refine mode, and use worth-considering gaps only when budget, history, and goal make them worthwhile.',
  ].join('\n\n');
}

function buildPrompt(
  context: SmartPicksContext,
  gaps: SmartPicksGapSnapshot[],
): string {
  const profile = context.skinProfile;
  return [
    `Mode: ${context.mode}. Budget tier: ${context.budgetTier ?? 'unset'}.`,
    'Use the budget tier to choose product fit only. Do not mention budget in gap reasons, recommendationRankReason, reasoning chips, or reasoning facts.',
    `Location: city=${profile?.city ?? '?'}, country=${profile?.country_code ?? '?'}.`,
    `Skin profile: type=${profile?.skin_type ?? '?'}, tone=${profile?.skin_tone ?? '?'}, ethnicity=${profile?.ethnicity ?? '?'}, primaryGoal=${profile?.primary_goal ?? '?'}, concerns=${(profile?.current_concerns ?? []).join(', ') || 'none'}.`,
    `Safety and preferences: ${JSON.stringify(buildSafetyAndPreferenceSummary(context))}`,
    `Shelf products to avoid recommending again:\n${context.allProducts.map(formatProduct).join('\n') || '(none)'}`,
    `Product performance summary:\n${formatProductPerformance(context)}`,
    `Gaps needing product picks:\n${gaps.map((gap) => `- key=${gap.normalizedKey}; kind=${gap.gapKind}; priority=${gap.priority}; category=${gap.ingredientOrCategory}; reason=${gap.reason}; replacementFor=${gap.replacementFor ? `${gap.replacementFor.productName}; usageDaysLast90=${gap.replacementFor.usageDaysLast90}; photoCheckpoints=${gap.replacementFor.photoCheckpoints}; reactionSignalCount=${gap.replacementFor.reactionSignalCount}` : 'none'}; sourceIds=${gap.sourceIds.join(',')}`).join('\n')}`,
    'Return one concrete product pick for every listed gap, including priority=consider gaps. The only difference is where Ritora displays the card.',
    'Rank product fit by the user goal, budget, skin profile, history, safety context, and shelf compatibility.',
    'For premium or luxury budgets, do not default to the cheapest basic option; choose the strongest compatible product fit and use alternatives for lower-cost tradeoffs.',
    'When the user has a budget tier, return a budgetTier for every main pick and alternative. Choose the closest tier from drugstore, mid, premium, or luxury instead of returning null.',
    'Do not use the same exact brand and product name for more than one gap. If two gaps are related, choose different products or put the shared product under the more important gap only.',
    "Choose globally by product fit first. Do not limit recommendations to the user's country.",
    'Local access is secondary to product fit. If the strongest product may be harder to find near the user, still name it and provide easier-to-find alternatives.',
    'Use broad product reputation, repeated public user-review patterns, and well-known category performance as secondary tie-breakers only.',
    'Do not assume South Korean, Canadian, Australian, American, European, or any country-specific products work better as a category.',
    'If the user is under dermatologist care, do not replace or contradict that care. Avoid products that duplicate or conflict with common prescribed actives unless the gap clearly asks for a compatible support step.',
    'For priority gaps, explain why this product matters now.',
    'For worth-considering gaps, explain why it may help but is not essential.',
    'For goal-focused gaps, infer the most specific evidence-aligned product category from the goal wording instead of recommending a generic product. Example: do not return "goal-focused serum"; return the concrete type and product that best fits the stated goal.',
    GOAL_SPECIFIC_PICK_GUIDANCE,
    'For replacement gaps, recommend a true replacement, not an add-on and not the same product. Explain in recommendationRankReason that the reason is logged use plus stalled photo/history signals, while avoiding diagnostic certainty.',
    'Photo and journal trends are decision support, not clinical proof. Never imply a product caused a reaction or failed; say the history suggests it may be time to consider a better-fitting replacement.',
    'For each gap, return one best product, up to two alternatives, optional reputable seller names only, and up to four ruled-out products when useful.',
    'Do not return purchase URLs, prices, affiliate flags, or seller verification claims. Put seller guidance in sellerNames as plain names only.',
    'Keep copy short. Reasoning chips should be under 42 characters.',
  ].join('\n\n');
}

function buildStarterTreatmentPrompt(context: SmartPicksContext): string {
  const profile = context.skinProfile;
  return [
    'Starter treatment assessment',
    `Mode: ${context.mode}. Budget tier: ${context.budgetTier ?? 'unset'}.`,
    `Location: city=${profile?.city ?? '?'}, country=${profile?.country_code ?? '?'}.`,
    `Skin profile: type=${profile?.skin_type ?? '?'}, tone=${profile?.skin_tone ?? '?'}, fitzpatrick=${profile?.fitzpatrick_phototype ?? '?'}, ethnicity=${profile?.ethnicity ?? '?'}.`,
    `Goal and concerns: primaryGoal=${profile?.primary_goal ?? '?'}, concerns=${(profile?.current_concerns ?? []).join(', ') || 'none'}, concernDetails=${JSON.stringify(profile?.concern_details ?? null)}.`,
    `Skin behavior and routine preference: ${JSON.stringify({
      behavior: profile?.skin_behavior ?? {},
      routine: profile?.routine_preferences ?? {},
      lifestyle: profile?.lifestyle_context ?? {},
    })}`,
    `Safety and preferences: ${JSON.stringify(buildSafetyAndPreferenceSummary(context))}`,
    `Current shelf:\n${context.activeProducts.map(formatProduct).join('\n') || '(none)'}`,
    `Product performance summary:\n${formatProductPerformance(context)}`,
    'Return shouldRecommend=false when cleanser, moisturizer, and sunscreen should come first without a treatment product.',
    'Return shouldRecommend=true only for one low-risk treatment category clearly tied to the stated goal or concern.',
    'Keep reason human, brief, and clear enough to show directly in the Starter Kit.',
  ].join('\n\n');
}

function buildSafetyAndPreferenceSummary(context: SmartPicksContext) {
  const profile = context.skinProfile;
  return {
    ingredientDislikes:
      profile?.shopping_preferences?.ingredient_dislikes ?? [],
    productDislikes: profile?.shopping_preferences?.product_dislikes ?? [],
    brandDislikes: profile?.shopping_preferences?.brand_dislikes ?? [],
    reactions:
      profile?.reaction_history?.entries?.map((entry) => ({
        trigger: entry.trigger,
        triggerType: entry.trigger_type,
        severity: entry.severity,
        certainty: entry.certainty,
      })) ?? [],
    activeTolerances: profile?.active_tolerances ?? {},
    pregnancyStatus: profile?.pregnancy_status ?? null,
    underDermatologistCare: profile?.under_dermatologist_care ?? null,
  };
}

function formatProduct(product: InventoryProduct): string {
  return `- ${product.brand} ${product.name}; category=${product.category}; status=${product.status}; ingredients=${(product.identity?.inciIngredients ?? []).slice(0, 16).join(', ')}`;
}

function formatProductWithId(product: InventoryProduct): string {
  return `- id=${product.id}; ${product.brand} ${product.name}; category=${product.category}; status=${product.status}; ingredients=${(product.identity?.inciIngredients ?? []).slice(0, 16).join(', ')}`;
}

function formatProductPerformance(context: SmartPicksContext): string {
  const summaries = context.productPerformance.filter(
    (summary) =>
      summary.replacementCandidate ||
      summary.goalTrend !==
        SmartPicksProductPerformanceSignal.InsufficientHistory,
  );
  if (summaries.length === 0) return '(insufficient history)';
  return summaries
    .map(
      (summary) =>
        `- product=${summary.brand} ${summary.productName}; category=${summary.category ?? 'unknown'}; adherence=${summary.adherence}; goalTrend=${summary.goalTrend}; concernTrend=${summary.concernTrend ?? 'unknown'}; usageDaysLast30=${summary.usageDaysLast30}; usageDaysLast90=${summary.usageDaysLast90}; photoCheckpoints=${summary.photoCheckpoints}; reactionSignalCount=${summary.reactionSignalCount}; replacementCandidate=${summary.replacementCandidate}; reason=${summary.replacementReason ?? 'none'}`,
    )
    .join('\n');
}

function extractOutputText(payload: {
  output?: { content?: { type: string; text?: string }[] }[];
}): string | null {
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.text) return content.text;
    }
  }
  return null;
}

async function openAiErrorMessage(
  response: Response,
  operation: string,
): Promise<string> {
  const details = await readOpenAiErrorDetails(response);
  return `OpenAI Smart Picks ${operation} call failed (${response.status})${details ? `: ${details}` : ''}.`;
}

async function readOpenAiErrorDetails(response: Response): Promise<string> {
  try {
    const payload = (await response.clone().json()) as {
      error?: { message?: unknown; code?: unknown; param?: unknown };
    };
    const message = sanitizeString(
      typeof payload.error?.message === 'string' ? payload.error.message : null,
      260,
    );
    const code = sanitizeString(
      typeof payload.error?.code === 'string' ? payload.error.code : null,
      80,
    );
    const param = sanitizeString(
      typeof payload.error?.param === 'string' ? payload.error.param : null,
      120,
    );
    return [code, param, message].filter(Boolean).join(' | ');
  } catch {
    return '';
  }
}

function sanitizeSmartPicksPlan(
  context: SmartPicksContext,
  parsed: RawSmartPicksPlanResponse,
): SmartPicksAiPlanGenerationResult {
  const activeProductsById = new Map(
    context.activeProducts.map((product) => [product.id, product]),
  );
  const diagnostics = {
    ...basePlanDiagnostics(),
    rawCoverageSlotCount: parsed.coverage?.slots?.length ?? 0,
    rawGapCount: parsed.gaps?.length ?? 0,
  };
  const coverageResult = sanitizePlanCoverageSlots(
    parsed.coverage?.slots ?? [],
    activeProductsById,
  );
  diagnostics.acceptedCoverageSlotCount = coverageResult.slots.length;
  diagnostics.invalidCoverageSlotCount = coverageResult.invalidCount;
  if (coverageResult.slots.length === 0) {
    return {
      plan: null,
      diagnostics: { ...diagnostics, missingPlan: true },
    };
  }

  const gapResult = sanitizePlanGaps(context, parsed.gaps ?? []);
  const gaps = gapResult.gaps;
  diagnostics.invalidGapCount = gapResult.invalidCount;
  diagnostics.blockedOwnedGapCount = gapResult.blockedOwnedCount;
  diagnostics.blockedSafetyGapCount = gapResult.blockedSafetyCount;
  diagnostics.blockedPregnancySafetyGapCount =
    gapResult.blockedPregnancySafetyCount;
  diagnostics.blockedReplacementEvidenceGapCount =
    gapResult.blockedReplacementEvidenceCount;
  if (
    gaps.length === 0 &&
    coverageResult.slots.some((slot) => slot.state !== 'filled')
  ) {
    return {
      plan: null,
      diagnostics: { ...diagnostics, missingPlan: true },
    };
  }

  const guardedGaps = applyMinimumConsiderGapGuardrails(
    context,
    applyReplacementGapGuardrails(
      context,
      applyCoveredShelfGapGuardrails(
        context,
        coverageResult.slots,
        applyStarterBasicGapGuardrails(context, coverageResult.slots, gaps),
      ),
    ),
  );

  const priorityGaps = guardedGaps
    .filter((gap) => gap.priority === 'priority')
    .slice(0, context.mode === 'starter' ? 4 : 3);
  const considerGaps = guardedGaps
    .filter((gap) => gap.priority === 'consider')
    .slice(0, aiConsiderGapLimit(context));
  const finalCoverageSlots = applyGapCoverageGuardrails(coverageResult.slots, [
    ...priorityGaps,
    ...considerGaps,
  ]);
  diagnostics.acceptedCoverageSlotCount = finalCoverageSlots.length;
  diagnostics.acceptedPriorityGapCount = priorityGaps.length;
  diagnostics.acceptedConsiderGapCount = considerGaps.length;
  diagnostics.acceptedGapCount = priorityGaps.length + considerGaps.length;

  return {
    plan: {
      coverage: {
        slots: finalCoverageSlots,
        filled: finalCoverageSlots.filter((slot) => slot.state === 'filled')
          .length,
        total: finalCoverageSlots.length,
      },
      priorityGaps,
      considerGaps,
    },
    diagnostics,
  };
}

function applyGapCoverageGuardrails(
  coverageSlots: SmartPicksCoverageSlot[],
  gaps: SmartPicksGapSnapshot[],
): SmartPicksCoverageSlot[] {
  const seenRoles = new Set(coverageSlots.map((slot) => slot.role));
  const additions: SmartPicksCoverageSlot[] = [];
  for (const gap of gaps) {
    if (gap.gapKind === SmartPicksGapKind.Replacement) continue;
    const role = inferCoverageRoleFromGap(gap);
    if (!role || seenRoles.has(role)) continue;
    seenRoles.add(role);
    additions.push({
      role,
      state: gap.priority === 'priority' ? 'missing-priority' : 'missing',
      filledByProductId: null,
      filledByName: null,
      goalRelevance: gap.priority === 'priority' ? 'essential' : 'optional',
    });
    if (coverageSlots.length + additions.length >= 10) break;
  }
  return additions.length > 0
    ? [...coverageSlots, ...additions]
    : coverageSlots;
}

function inferCoverageRoleFromGap(
  gap: SmartPicksGapSnapshot,
): SmartPicksCoverageRole | null {
  const text = [
    gap.ingredientOrCategory,
    gap.normalizedKey,
    gap.reason,
    gap.shortReason,
    gap.goalAlignment,
  ]
    .join(' ')
    .toLowerCase();
  if (/\b(spf|sunscreen|sun protection)\b/.test(text)) return 'spf';
  if (/\b(cleanser|cleansing|cleanse|face wash|gel wash)\b/.test(text)) {
    return 'cleanse';
  }
  if (/\b(vitamin c|ascorbic|ascorbyl|antioxidant)\b/.test(text)) {
    return 'antioxidant';
  }
  if (/\b(peptide|matrixyl|argireline)\b/.test(text)) return 'peptide';
  if (/\b(clay|kaolin|bentonite|sulfur|congestion mask)\b/.test(text)) {
    return 'congestion-mask';
  }
  if (
    /\b(mask|peel|resurfacing mask|sleeping mask|overnight mask)\b/.test(text)
  ) {
    return /\b(recovery|sleeping|overnight|cica|barrier)\b/.test(text)
      ? 'recovery-mask'
      : 'exfoliation-mask';
  }
  if (
    /\b(dark spot|dark mark|hyperpigmentation|melasma|pigment|tranexamic|kojic|alpha arbutin|arbutin)\b/.test(
      text,
    )
  ) {
    return 'dark-spot-treatment';
  }
  if (
    /\b(acne|breakout|blemish|benzoyl peroxide|spot treatment)\b/.test(text) ||
    isSalicylicBhaTreatmentText(text)
  ) {
    return 'acne-treatment';
  }
  if (/\b(retinol|retinal|retinoid|adapalene|tretinoin)\b/.test(text)) {
    return 'retinoid';
  }
  if (
    /\b(aha|bha|pha|glycolic|lactic|mandelic|salicylic|exfoliant)\b/.test(text)
  ) {
    return 'texture-exfoliant';
  }
  if (
    /\b(hydrat|hyaluronic|humectant|glycerin|beta glucan|urea)\b/.test(text)
  ) {
    return 'hydrate';
  }
  if (/\b(moisturi[sz]er|moisturi[sz]e|cream|lotion)\b/.test(text)) {
    return 'moisturise';
  }
  if (
    /\b(barrier|niacinamide|panthenol|centella|ceramide|cica|squalane)\b/.test(
      text,
    )
  ) {
    return 'barrier-support';
  }
  return null;
}

function isSalicylicBhaTreatmentText(text: string): boolean {
  if (!/\b(bha|salicylic)\b/.test(text)) return false;
  return !/\b(texture|rough|body|exfoliant|exfoliating|mask|peel|resurfacing)\b/.test(
    text,
  );
}

type ConsiderGapGuardrailCandidate = {
  ingredientOrCategory: string;
  reason: string;
  goalAlignment: string;
  sourceIds: readonly SuggestionEvidenceSourceId[];
};

function applyMinimumConsiderGapGuardrails(
  context: SmartPicksContext,
  gaps: SmartPicksGapSnapshot[],
): SmartPicksGapSnapshot[] {
  const limit = aiConsiderGapLimit(context);
  if (limit === 0) return gaps;
  const blockedTokens = blockedPreferenceTokens(context);
  let result = [...gaps];
  for (const candidate of requiredConsiderGapGuardrailCandidates(
    context,
    result,
  ).reverse()) {
    const gap = considerGapFromCandidate(context, candidate, blockedTokens);
    if (!gap) continue;
    result = [gap, ...result];
  }

  const minimum = minimumConsiderGapCount(context);
  if (minimum === 0) return result;
  let considerCount = result.filter(
    (gap) => gap.priority === 'consider',
  ).length;
  if (considerCount >= minimum) return result;

  const existingKeys = new Set(result.map((gap) => gap.normalizedKey));
  for (const candidate of considerGapGuardrailCandidates(context)) {
    if (considerCount >= minimum || considerCount >= limit) break;
    const gap = considerGapFromCandidate(context, candidate, blockedTokens);
    if (!gap || existingKeys.has(gap.normalizedKey)) continue;
    result.push(gap);
    existingKeys.add(gap.normalizedKey);
    considerCount += 1;
  }
  return result;
}

function requiredConsiderGapGuardrailCandidates(
  context: SmartPicksContext,
  gaps: SmartPicksGapSnapshot[],
): ConsiderGapGuardrailCandidate[] {
  const profile = context.skinProfile;
  const candidates: ConsiderGapGuardrailCandidate[] = [];
  const goalText = [
    profile?.primary_goal ?? '',
    ...(profile?.current_concerns ?? []),
  ]
    .join(' ')
    .toLowerCase();
  const hasFineLineGoal = /fine line|wrinkle|firm|aging|ageing/.test(goalText);
  const lacksPeptideSupport = !hasConsiderGapMatching(
    gaps,
    /\b(peptide|barrier|ceramide|panthenol|glycerin|squalane)\b/,
  );
  if (
    (context.budgetTier === 'premium' || context.budgetTier === 'luxury') &&
    /dark|mark|hyperpigment|pigment|melasma|uneven tone|tone/.test(goalText) &&
    !hasConsiderGapMatching(
      gaps,
      /\b(vitamin c|ascorbic|ascorbyl|antioxidant)\b/,
    )
  ) {
    candidates.push(
      considerCandidate(
        'Vitamin C antioxidant serum',
        'Antioxidant support may help the tone-focused routine, but it is secondary to the main treatment and sunscreen steps.',
        'tone support',
        [
          SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
          SuggestionEvidenceSourceId.AadMelasmaTreatment,
        ],
      ),
    );
  }
  if (
    hasFineLineGoal &&
    lacksPeptideSupport &&
    (isPregnancyCautionActive(profile?.pregnancy_status ?? null) ||
      context.budgetTier === 'premium' ||
      context.budgetTier === 'luxury')
  ) {
    const pregnancySafe = isPregnancyCautionActive(
      profile?.pregnancy_status ?? null,
    );
    candidates.push(
      considerCandidate(
        'Peptide or barrier-support serum',
        pregnancySafe
          ? 'A pregnancy-compatible peptide or barrier-support lane is a safer optional path for this goal.'
          : 'A peptide or barrier-support lane gives the fine-line routine a lower-irritation support option alongside stronger treatment steps.',
        'fine line support',
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
      ),
    );
  }
  if (
    hasFineLineGoal &&
    (context.budgetTier === 'premium' || context.budgetTier === 'luxury') &&
    !hasConsiderGapMatching(
      gaps,
      /\b(vitamin c|ascorbic|ascorbyl|antioxidant)\b/,
    )
  ) {
    candidates.push(
      considerCandidate(
        'Vitamin C antioxidant serum',
        'Antioxidant support can complement sunscreen for long-view fine-line, tone, and texture support.',
        'antioxidant support',
        [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
      ),
    );
  }
  if (
    /\b(body|arm|arms|leg|legs|rough bump|bumps|keratosis|kp)\b/.test(
      goalText,
    ) &&
    /\b(dry|rough|texture|bump|bumps)\b/.test(goalText) &&
    !hasConsiderGapMatching(
      gaps,
      /\b(body barrier|body moisturizer|body moisturiser|body lotion|urea|glycerin|panthenol|ceramide)\b/,
    )
  ) {
    candidates.push(
      considerCandidate(
        'Fragrance-free body barrier moisturizer',
        'A body barrier moisturizer can support dryness around the smoothing step without adding another strong active.',
        'body barrier support',
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
      ),
    );
  }
  return candidates;
}

function hasConsiderGapMatching(
  gaps: SmartPicksGapSnapshot[],
  pattern: RegExp,
): boolean {
  return gaps.some(
    (gap) => gap.priority === 'consider' && pattern.test(gapText(gap)),
  );
}

function considerGapFromCandidate(
  context: SmartPicksContext,
  candidate: ConsiderGapGuardrailCandidate,
  blockedTokens: readonly string[],
): SmartPicksGapSnapshot | null {
  const candidateText = `${candidate.ingredientOrCategory} ${
    candidate.reason
  } ${candidate.goalAlignment}`.toLowerCase();
  if (containsBlockedPreference(candidateText, blockedTokens)) return null;
  if (
    isPregnancyCautionActive(context.skinProfile?.pregnancy_status ?? null) &&
    /(retinol|retinal|retinoid|tretinoin|adapalene)/i.test(candidateText)
  ) {
    return null;
  }
  return {
    ingredientOrCategory: candidate.ingredientOrCategory,
    normalizedKey: normalizeSuggestionGapKey(candidate.ingredientOrCategory),
    priority: 'consider',
    reason: candidate.reason,
    shortReason: buildAiPlanShortReason(candidate.reason),
    goalAlignment: candidate.goalAlignment,
    sourceIds: mergeEvidenceSourceIds([...candidate.sourceIds]),
    gapKind: SmartPicksGapKind.GoalSupport,
    replacementFor: null,
  };
}

function gapText(gap: SmartPicksGapSnapshot): string {
  return `${gap.ingredientOrCategory} ${gap.normalizedKey} ${gap.reason} ${
    gap.shortReason ?? ''
  } ${gap.goalAlignment ?? ''}`.toLowerCase();
}

function minimumConsiderGapCount(context: SmartPicksContext): number {
  const isHighBudget =
    context.budgetTier === 'premium' || context.budgetTier === 'luxury';
  if (!isHighBudget) return 0;
  const profile = context.skinProfile;
  const hasGoalContext = Boolean(
    profile?.primary_goal?.trim() || (profile?.current_concerns ?? []).length,
  );
  return hasGoalContext ? 2 : 0;
}

function considerGapGuardrailCandidates(
  context: SmartPicksContext,
): ConsiderGapGuardrailCandidate[] {
  const profile = context.skinProfile;
  const goalText = [
    profile?.primary_goal ?? '',
    ...(profile?.current_concerns ?? []),
  ]
    .join(' ')
    .toLowerCase();
  if (
    /dark|mark|hyperpigment|pigment|melasma|uneven tone|tone/.test(goalText)
  ) {
    return [
      considerCandidate(
        'Vitamin C antioxidant serum',
        'Antioxidant support may help the tone-focused routine, but it is secondary to the main treatment and sunscreen steps.',
        'tone support',
        [
          SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
          SuggestionEvidenceSourceId.AadMelasmaTreatment,
        ],
      ),
      considerCandidate(
        'Gentle resurfacing mask or peel',
        'A low-frequency resurfacing step may help texture and dullness if the routine stays calm.',
        'texture support',
        [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
      ),
    ];
  }
  if (/breakout|blemish|congestion|clogged|pore|pimple/.test(goalText)) {
    return [
      considerCandidate(
        'Barrier-support serum',
        'Barrier support can make active steps easier to tolerate when the routine is already treating congestion.',
        'barrier support',
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
      ),
      considerCandidate(
        'Clay or sulfur congestion mask',
        'An occasional rinse-off support can help congestion-prone routines without becoming another daily active.',
        'congestion support',
        [SuggestionEvidenceSourceId.AadAcneTreatment],
      ),
    ];
  }
  if (/texture|rough|bumpy|smooth/.test(goalText)) {
    return [
      considerCandidate(
        'Gentle resurfacing mask or peel',
        'A low-frequency resurfacing step may help texture if the current routine stays calm.',
        'texture support',
        [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
      ),
      considerCandidate(
        'Peptide support serum',
        'Peptide support can be a lower-irritation add-on when stronger actives are not the next best step.',
        'supportive treatment',
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
      ),
    ];
  }
  if (/fine line|wrinkle|firm|aging|ageing/.test(goalText)) {
    return [
      considerCandidate(
        'Peptide support serum',
        'Peptide support may be useful on nights when stronger actives are not a fit.',
        'firmness support',
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
      ),
      considerCandidate(
        'Vitamin C antioxidant serum',
        'Antioxidant support may complement sunscreen for long-view tone and texture support.',
        'antioxidant support',
        [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
      ),
    ];
  }
  if (
    /dry|dehydrat|hydrat|barrier|redness|sensitive|irritat|calm/.test(goalText)
  ) {
    return [
      considerCandidate(
        'Humectant hydration serum',
        'A dedicated hydration layer can help comfort when cleanser, moisturizer, and sunscreen are already covered.',
        'hydration support',
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
      ),
      considerCandidate(
        'Recovery mask or balm',
        'A recovery step can be useful for occasional dry or irritated patches without changing the daily routine.',
        'recovery support',
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
      ),
    ];
  }
  return [
    considerCandidate(
      'Antioxidant support serum',
      'A simple antioxidant can be a useful optional support when the main routine is already covered.',
      'routine support',
      [SuggestionEvidenceSourceId.MayoDrySkinCare],
    ),
    considerCandidate(
      'Recovery mask or balm',
      'A recovery step can help occasional dryness or irritation without adding another daily active.',
      'comfort support',
      [SuggestionEvidenceSourceId.MayoDrySkinCare],
    ),
  ];
}

function considerCandidate(
  ingredientOrCategory: string,
  reason: string,
  goalAlignment: string,
  sourceIds: readonly SuggestionEvidenceSourceId[],
): ConsiderGapGuardrailCandidate {
  return { ingredientOrCategory, reason, goalAlignment, sourceIds };
}

function applyCoveredShelfGapGuardrails(
  context: SmartPicksContext,
  coverageSlots: SmartPicksCoverageSlot[],
  gaps: SmartPicksGapSnapshot[],
): SmartPicksGapSnapshot[] {
  if (context.mode !== 'refine') return gaps;
  if (coverageSlots.length === 0) return gaps;
  if (coverageSlots.some((slot) => slot.state !== 'filled')) return gaps;
  if (
    context.productPerformance.some((summary) => summary.replacementCandidate)
  ) {
    return gaps;
  }
  const canKeepOptionalExtras =
    context.budgetTier === 'premium' || context.budgetTier === 'luxury';
  return gaps.flatMap((gap) => {
    if (gap.gapKind === SmartPicksGapKind.Replacement) return [gap];
    if (gap.priority === 'consider') return [gap];
    return canKeepOptionalExtras ? [{ ...gap, priority: 'consider' }] : [];
  });
}

function applyReplacementGapGuardrails(
  context: SmartPicksContext,
  gaps: SmartPicksGapSnapshot[],
): SmartPicksGapSnapshot[] {
  if (context.mode === 'starter') return gaps;
  const additions = context.productPerformance
    .filter((summary) => summary.replacementCandidate)
    .filter(
      (summary) =>
        !gaps.some(
          (gap) =>
            gap.gapKind === SmartPicksGapKind.Replacement &&
            gap.replacementFor?.productId === summary.productId,
        ),
    )
    .slice(0, 2)
    .map(replacementGuardrailGap);
  return additions.length > 0 ? [...additions, ...gaps] : gaps;
}

function replacementGuardrailGap(
  summary: SmartPicksProductPerformanceSummary,
): SmartPicksGapSnapshot {
  const reason =
    summary.replacementReason ??
    'Your use logs and photo history suggest this step may need a better-fitting replacement.';
  return {
    ingredientOrCategory: `Replacement for ${summary.productName}`,
    normalizedKey: normalizeSuggestionGapKey(
      `Replacement for ${summary.productName}`,
    ),
    priority: 'priority',
    reason,
    shortReason: buildAiPlanShortReason(reason),
    goalAlignment: summary.concernTrend ?? 'history-informed replacement',
    sourceIds: mergeEvidenceSourceIds(replacementSourceIds(summary)),
    gapKind: SmartPicksGapKind.Replacement,
    replacementFor: summary,
  };
}

function replacementSourceIds(
  summary: SmartPicksProductPerformanceSummary,
): SuggestionEvidenceSourceId[] {
  const concernText = `${summary.concernTrend ?? ''} ${
    summary.replacementReason ?? ''
  }`.toLowerCase();
  if (/hyper|pigment|dark|mark|tone/.test(concernText)) {
    return [
      SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
      SuggestionEvidenceSourceId.AadMelasmaTreatment,
    ];
  }
  if (/irrit|reaction|retinoid|retinol/.test(concernText)) {
    return [
      SuggestionEvidenceSourceId.AadRetinoidRetinol,
      SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
    ];
  }
  return [SuggestionEvidenceSourceId.MayoDrySkinCare];
}

function applyStarterBasicGapGuardrails(
  context: SmartPicksContext,
  coverageSlots: SmartPicksCoverageSlot[],
  gaps: SmartPicksGapSnapshot[],
): SmartPicksGapSnapshot[] {
  if (context.mode !== 'starter' || context.activeProducts.length > 0) {
    return gaps;
  }
  const guardedGaps = [...gaps];
  const additions: SmartPicksGapSnapshot[] = [];
  for (const guardrail of STARTER_BASIC_GAP_GUARDRAILS) {
    const slot = coverageSlots.find((item) => item.role === guardrail.role);
    if (slot?.state === 'filled') continue;
    const matchingIndex = guardedGaps.findIndex((gap) =>
      guardrail.matchesGap(gap.normalizedKey),
    );
    if (matchingIndex === -1) {
      additions.push(starterGuardrailGap(context, guardrail));
      continue;
    }
    const matchingGap = guardedGaps[matchingIndex];
    if (
      guardrail.role === 'moisturise' &&
      matchingGap &&
      !isSpecificStarterMoisturizerGap(matchingGap)
    ) {
      guardedGaps[matchingIndex] = starterGuardrailGap(context, guardrail);
    }
    if (
      guardrail.role === 'spf' &&
      matchingGap &&
      needsSensitiveStarterSunscreen(context) &&
      !isSensitiveStarterSunscreenGap(matchingGap)
    ) {
      guardedGaps[matchingIndex] = starterGuardrailGap(context, guardrail);
    }
  }
  return additions.length > 0 ? [...additions, ...guardedGaps] : guardedGaps;
}

const STARTER_BASIC_GAP_GUARDRAILS: readonly {
  role: SmartPicksCoverageRole;
  ingredientOrCategory: string;
  reason: string;
  goalAlignment: string;
  sourceIds: readonly SuggestionEvidenceSourceId[];
  matchesGap: (normalizedKey: string) => boolean;
}[] = [
  {
    role: 'cleanse',
    ingredientOrCategory: 'Low-stripping gentle cleanser',
    reason:
      'A starter routine needs a gentle cleanse step before treatment products.',
    goalAlignment: 'starter routine',
    sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
    matchesGap: (key) => key.includes('cleanser') || key.includes('cleanse'),
  },
  {
    role: 'moisturise',
    ingredientOrCategory: 'Barrier-support moisturizer',
    reason:
      'A starter routine needs moisturizer to keep treatment steps tolerable.',
    goalAlignment: 'barrier support',
    sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
    matchesGap: (key) =>
      key.includes('moisturizer') ||
      key.includes('moisturiser') ||
      key.includes('moisturise') ||
      key.includes('barrier'),
  },
  {
    role: 'spf',
    ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
    reason:
      'A starter routine needs daily sunscreen before progress can be protected.',
    goalAlignment: 'sun protection',
    sourceIds: [
      SuggestionEvidenceSourceId.AadSunscreenSelection,
      SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
    ],
    matchesGap: (key) => key.includes('sunscreen') || key.includes('spf'),
  },
];

function starterGuardrailGap(
  context: SmartPicksContext,
  guardrail: (typeof STARTER_BASIC_GAP_GUARDRAILS)[number],
): SmartPicksGapSnapshot {
  const ingredientOrCategory =
    guardrail.role === 'spf' && needsSensitiveStarterSunscreen(context)
      ? 'Sensitive-skin sunscreen'
      : guardrail.ingredientOrCategory;
  const reason =
    guardrail.role === 'spf' && needsSensitiveStarterSunscreen(context)
      ? 'A sensitive starter routine needs a daily sunscreen that keeps irritation risk and finish in mind.'
      : guardrail.reason;
  const goalAlignment =
    guardrail.role === 'spf' && needsSensitiveStarterSunscreen(context)
      ? 'sensitive skin sun protection'
      : guardrail.goalAlignment;
  return {
    ingredientOrCategory,
    normalizedKey: normalizeSuggestionGapKey(ingredientOrCategory),
    priority: 'priority',
    reason,
    shortReason: buildAiPlanShortReason(reason),
    goalAlignment,
    sourceIds: mergeEvidenceSourceIds([...guardrail.sourceIds]),
    gapKind: SmartPicksGapKind.Starter,
    replacementFor: null,
  };
}

function isSpecificStarterMoisturizerGap(gap: SmartPicksGapSnapshot): boolean {
  return /\b(barrier|ceramide|panthenol|centella|glycerin|squalane|cica|repair|recovery|bland)\b/.test(
    `${gap.ingredientOrCategory} ${gap.normalizedKey}`.toLowerCase(),
  );
}

function needsSensitiveStarterSunscreen(context: SmartPicksContext): boolean {
  const profile = context.skinProfile;
  const text = [
    profile?.primary_goal ?? '',
    ...(profile?.current_concerns ?? []),
    ...(profile?.shopping_preferences?.ingredient_dislikes ?? []),
    ...(profile?.reaction_history?.entries?.map((entry) => entry.trigger) ??
      []),
  ]
    .join(' ')
    .toLowerCase();
  return /\b(sensitive|sensitivity|redness|irritation|irritated|fragrance|eczema|rosacea|dry|barrier)\b/.test(
    text,
  );
}

function isSensitiveStarterSunscreenGap(gap: SmartPicksGapSnapshot): boolean {
  return /\b(sensitive|fragrance-free|fragrance free|mineral|low-irritation|irritation)\b/.test(
    `${gap.ingredientOrCategory} ${gap.normalizedKey}`.toLowerCase(),
  );
}

function sanitizePlanCoverageSlots(
  slots: RawSmartPicksCoverageSlot[],
  activeProductsById: ReadonlyMap<string, InventoryProduct>,
): { slots: SmartPicksCoverageSlot[]; invalidCount: number } {
  const seenRoles = new Set<SmartPicksCoverageRole>();
  const sanitized: SmartPicksCoverageSlot[] = [];
  let invalidCount = 0;
  for (const slot of slots) {
    const role = sanitizeCoverageRole(slot.role);
    const state = sanitizeCoverageState(slot.state);
    const goalRelevance = sanitizeGoalRelevance(slot.goalRelevance);
    if (!role || !state || !goalRelevance || seenRoles.has(role)) {
      invalidCount += 1;
      continue;
    }
    const filledProduct =
      state === 'filled' && slot.filledByProductId
        ? activeProductsById.get(slot.filledByProductId)
        : null;
    sanitized.push({
      role,
      state: filledProduct ? 'filled' : state === 'filled' ? 'missing' : state,
      filledByProductId: filledProduct?.id ?? null,
      filledByName: filledProduct
        ? `${filledProduct.brand} ${filledProduct.name}`
        : null,
      goalRelevance,
    });
    seenRoles.add(role);
    if (sanitized.length >= 10) break;
  }
  return { slots: sanitized, invalidCount };
}

function sanitizePlanGaps(
  context: SmartPicksContext,
  rawGaps: RawSmartPicksPlanGap[],
): {
  gaps: SmartPicksGapSnapshot[];
  invalidCount: number;
  blockedOwnedCount: number;
  blockedSafetyCount: number;
  blockedPregnancySafetyCount: number;
  blockedReplacementEvidenceCount: number;
} {
  const ownedKeys = new Set(
    context.allProducts.map((product) =>
      productIdentityKey(product.brand, product.name),
    ),
  );
  const ownedNameKeys = new Set(
    context.allProducts.flatMap((product) => [
      normalizeSuggestionGapKey(product.name),
      normalizeSuggestionGapKey(`${product.brand} ${product.name}`),
    ]),
  );
  const performanceByProductId = new Map(
    context.productPerformance.map((summary) => [summary.productId, summary]),
  );
  const blockedTokens = blockedPreferenceTokens(context);
  const seenKeys = new Set<string>();
  const gaps: SmartPicksGapSnapshot[] = [];
  let invalidCount = 0;
  let blockedOwnedCount = 0;
  let blockedSafetyCount = 0;
  let blockedPregnancySafetyCount = 0;
  let blockedReplacementEvidenceCount = 0;
  for (const rawGap of rawGaps) {
    const ingredientOrCategory = sanitizeString(
      sanitizeSkinToneCopy(rawGap.ingredientOrCategory ?? ''),
      160,
    );
    const priority =
      rawGap.priority === 'priority' || rawGap.priority === 'consider'
        ? rawGap.priority
        : null;
    const reason = sanitizeString(
      sanitizeSkinToneCopy(rawGap.reason ?? ''),
      360,
    );
    if (!ingredientOrCategory || !priority || !reason) {
      invalidCount += 1;
      continue;
    }
    const normalizedKey = normalizeSuggestionGapKey(ingredientOrCategory);
    if (seenKeys.has(normalizedKey)) {
      invalidCount += 1;
      continue;
    }
    const combinedText = `${ingredientOrCategory} ${reason} ${
      rawGap.goalAlignment ?? ''
    }`.toLowerCase();
    if (
      ownedKeys.has(productIdentityKey('', ingredientOrCategory)) ||
      ownedNameKeys.has(normalizedKey)
    ) {
      blockedOwnedCount += 1;
      continue;
    }
    if (containsBlockedPreference(combinedText, blockedTokens)) {
      blockedSafetyCount += 1;
      continue;
    }
    if (
      isPregnancyCautionActive(context.skinProfile?.pregnancy_status ?? null) &&
      /(retinol|retinal|retinoid|tretinoin|adapalene)/i.test(combinedText)
    ) {
      blockedSafetyCount += 1;
      blockedPregnancySafetyCount += 1;
      continue;
    }
    const requestedGapKind = sanitizeGapKind(rawGap.gapKind, context.mode);
    const replacementFor =
      requestedGapKind === SmartPicksGapKind.Replacement &&
      rawGap.replacementForProductId
        ? (performanceByProductId.get(rawGap.replacementForProductId) ?? null)
        : null;
    if (
      requestedGapKind === SmartPicksGapKind.Replacement &&
      !replacementFor?.replacementCandidate
    ) {
      blockedReplacementEvidenceCount += 1;
      continue;
    }
    const gapKind = replacementFor
      ? SmartPicksGapKind.Replacement
      : requestedGapKind;
    const sanitizedPriority = replacementFor ? 'priority' : priority;
    seenKeys.add(normalizedKey);
    gaps.push({
      ingredientOrCategory,
      normalizedKey,
      priority: sanitizedPriority,
      reason,
      shortReason:
        sanitizeString(sanitizeSkinToneCopy(rawGap.shortReason ?? ''), 140) ??
        buildAiPlanShortReason(reason),
      goalAlignment: sanitizeString(
        sanitizeSkinToneCopy(rawGap.goalAlignment ?? ''),
        120,
      ),
      sourceIds: mergeEvidenceSourceIds(
        sanitizeSourceIds(rawGap.sourceIds ?? []),
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
      ),
      gapKind,
      replacementFor,
    });
    if (gaps.length >= 10) break;
  }
  return {
    gaps,
    invalidCount,
    blockedOwnedCount,
    blockedSafetyCount,
    blockedPregnancySafetyCount,
    blockedReplacementEvidenceCount,
  };
}

function basePlanDiagnostics(): SmartPicksAiPlanDiagnostics {
  return {
    rawCoverageSlotCount: 0,
    acceptedCoverageSlotCount: 0,
    invalidCoverageSlotCount: 0,
    rawGapCount: 0,
    acceptedGapCount: 0,
    acceptedPriorityGapCount: 0,
    acceptedConsiderGapCount: 0,
    invalidGapCount: 0,
    blockedOwnedGapCount: 0,
    blockedSafetyGapCount: 0,
    blockedPregnancySafetyGapCount: 0,
    blockedReplacementEvidenceGapCount: 0,
    providerFailed: false,
    providerSkippedReason: null,
    missingPlan: false,
  };
}

function sanitizeCoverageRole(
  value: string | null | undefined,
): SmartPicksCoverageRole | null {
  return SMART_PICKS_COVERAGE_ROLES.includes(value as SmartPicksCoverageRole)
    ? (value as SmartPicksCoverageRole)
    : null;
}

function sanitizeCoverageState(
  value: string | null | undefined,
): SmartPicksCoverageState | null {
  return ['filled', 'missing', 'missing-priority'].includes(value ?? '')
    ? (value as SmartPicksCoverageState)
    : null;
}

function sanitizeGoalRelevance(
  value: string | null | undefined,
): SmartPicksGoalRelevance | null {
  return ['essential', 'supportive', 'optional'].includes(value ?? '')
    ? (value as SmartPicksGoalRelevance)
    : null;
}

function sanitizeGapKind(
  value: string | null | undefined,
  mode: SmartPicksContext['mode'],
): SmartPicksGapKind {
  if (mode === 'starter') return SmartPicksGapKind.Starter;
  return Object.values(SmartPicksGapKind).includes(value as SmartPicksGapKind)
    ? (value as SmartPicksGapKind)
    : SmartPicksGapKind.GoalSupport;
}

function buildAiPlanShortReason(reason: string): string {
  const sentence = reason.split(/(?<=[.!?])\s+/)[0] ?? reason;
  return sentence.length > 140
    ? `${sentence.slice(0, 137).trim()}...`
    : sentence;
}

function aiConsiderGapLimit(context: SmartPicksContext): number {
  if (context.mode === 'starter') {
    if (context.budgetTier === 'premium' || context.budgetTier === 'luxury') {
      return 2;
    }
    return context.budgetTier === 'mid' ? 1 : 0;
  }
  return context.budgetTier === 'premium' || context.budgetTier === 'luxury'
    ? 4
    : 2;
}

function sanitizeGeneratedPicks(
  context: SmartPicksContext,
  gaps: SmartPicksGapSnapshot[],
  parsed: RawSmartPickResponse,
): SmartPicksAiGenerationResult {
  const gapsByKey = new Map(gaps.map((gap) => [gap.normalizedKey, gap]));
  const ownedKeys = new Set(
    context.allProducts.map((product) =>
      productIdentityKey(product.brand, product.name),
    ),
  );
  const blockedTokens = blockedPreferenceTokens(context);
  const picks = new Map<string, GeneratedSmartPick>();
  const pickedIdentityKeys = new Set<string>();
  const diagnostics = baseDiagnostics(gaps.length);
  diagnostics.rawGapCount = parsed.gaps?.length ?? 0;
  for (const rawGap of parsed.gaps ?? []) {
    const normalizedKey = resolveGeneratedGapKey(
      rawGap.normalizedKey,
      gapsByKey,
    );
    if (!normalizedKey) {
      diagnostics.invalidPickCount += 1;
      continue;
    }
    const result = sanitizePick(rawGap, {
      context,
      ownedKeys,
      blockedTokens,
      fallbackSourceIds: gapsByKey.get(normalizedKey)?.sourceIds ?? [],
    });
    if (result.pick) {
      const pickIdentity = productIdentityKey(
        result.pick.brand,
        result.pick.productName,
      );
      if (pickedIdentityKeys.has(pickIdentity)) {
        diagnostics.invalidPickCount += 1;
        continue;
      }
      pickedIdentityKeys.add(pickIdentity);
      picks.set(normalizedKey, result.pick);
      continue;
    }
    incrementBlockedDiagnostic(diagnostics, result.blockReason);
  }
  diagnostics.acceptedPickCount = picks.size;
  diagnostics.missingPickCount = Math.max(0, gaps.length - picks.size);
  return { picks, diagnostics };
}

function resolveGeneratedGapKey(
  rawKey: string | null | undefined,
  gapsByKey: ReadonlyMap<string, SmartPicksGapSnapshot>,
): string | null {
  const sanitized = sanitizeString(rawKey, 180);
  if (!sanitized) return null;
  if (gapsByKey.has(sanitized)) return sanitized;

  const normalized = normalizeSuggestionGapKey(sanitized);
  return gapsByKey.has(normalized) ? normalized : null;
}

function sanitizePick(
  raw: RawSmartPickGap | RawSmartPickAlternative,
  options: {
    context: SmartPicksContext;
    ownedKeys: ReadonlySet<string>;
    blockedTokens: readonly string[];
    fallbackSourceIds: SuggestionEvidenceSourceId[];
  },
): SanitizePickResult {
  const brand = sanitizeString(raw.brand, 120);
  const productName = sanitizeString(raw.productName, 200);
  if (!brand || !productName) {
    return promoteAlternativeOrBlock(raw, options, 'invalid');
  }
  const identityKey = productIdentityKey(brand, productName);
  if (options.ownedKeys.has(identityKey)) {
    return promoteAlternativeOrBlock(raw, options, 'owned');
  }
  const combinedText = `${brand} ${productName}`.toLowerCase();
  if (containsBlockedPreference(combinedText, options.blockedTokens)) {
    return promoteAlternativeOrBlock(raw, options, 'safety');
  }

  const budgetTier = sanitizeBudget(raw.budgetTier);
  if (options.context.budgetTier && !budgetTier) {
    return promoteAlternativeOrBlock(raw, options, 'budget');
  }
  if (
    options.context.budgetTier &&
    budgetTier &&
    !budgetAllowed(options.context.budgetTier, budgetTier)
  ) {
    return promoteAlternativeOrBlock(raw, options, 'budget');
  }

  const sellerNames = sanitizeSellerNames(raw.sellerNames ?? []);
  const recommendationRankReason = sanitizeUserFacingReason(
    raw.recommendationRankReason,
    260,
  );
  const alternatives = (raw.alternatives ?? [])
    .map((alternative) =>
      sanitizePick(alternative, {
        ...options,
        fallbackSourceIds: raw.sourceIds ?? options.fallbackSourceIds,
      }),
    )
    .map((result) => result.pick)
    .filter((pick): pick is GeneratedSmartPick => Boolean(pick))
    .slice(0, 2)
    .map((pick) => ({
      brand: pick.brand,
      productName: pick.productName,
      budgetTier: pick.budgetTier,
      sellerNames: pick.sellerNames,
      reasoningChips: pick.reasoningChips,
      reasoningFacts: pick.reasoningFacts,
      ruledOut: pick.ruledOut,
      sourceIds: pick.sourceIds,
      recommendationRankReason: pick.recommendationRankReason,
      alternatives: [],
    }));

  return {
    pick: {
      brand,
      productName,
      budgetTier,
      sellerNames,
      reasoningChips: sanitizeReasoningChips(raw.reasoningChips ?? []),
      reasoningFacts: sanitizeReasoningFacts(raw.reasoningFacts ?? {}),
      ruledOut: sanitizeRuledOut(raw.ruledOut ?? []),
      sourceIds: mergeEvidenceSourceIds(
        sanitizeSourceIds(raw.sourceIds ?? []),
        options.fallbackSourceIds,
      ),
      alternatives,
      recommendationRankReason,
    },
    blockReason: null,
  };
}

function promoteAlternativeOrBlock(
  raw: RawSmartPickGap | RawSmartPickAlternative,
  options: {
    context: SmartPicksContext;
    ownedKeys: ReadonlySet<string>;
    blockedTokens: readonly string[];
    fallbackSourceIds: SuggestionEvidenceSourceId[];
  },
  blockReason: SanitizePickBlockReason,
): SanitizePickResult {
  for (const alternative of raw.alternatives ?? []) {
    const result = sanitizePick(alternative, {
      ...options,
      fallbackSourceIds: raw.sourceIds ?? options.fallbackSourceIds,
    });
    if (result.pick) return result;
  }
  return blockedPick(blockReason);
}

function blockedPick(blockReason: SanitizePickBlockReason): SanitizePickResult {
  return { pick: null, blockReason };
}

function emptyGenerationResult(
  requestedGapCount: number,
  providerSkippedReason: SmartPicksAiProviderSkippedReason,
): SmartPicksAiGenerationResult {
  return {
    picks: new Map(),
    diagnostics: {
      ...baseDiagnostics(requestedGapCount),
      providerSkippedReason,
      missingPickCount: requestedGapCount,
    },
  };
}

function failedGenerationResult(
  requestedGapCount: number,
): SmartPicksAiGenerationResult {
  return {
    picks: new Map(),
    diagnostics: {
      ...baseDiagnostics(requestedGapCount),
      missingPickCount: requestedGapCount,
      providerFailed: true,
    },
  };
}

function baseDiagnostics(
  requestedGapCount: number,
): SmartPicksAiGenerationDiagnostics {
  return {
    requestedGapCount,
    rawGapCount: 0,
    acceptedPickCount: 0,
    blockedOwnedCount: 0,
    blockedBudgetCount: 0,
    blockedSafetyCount: 0,
    invalidPickCount: 0,
    missingPickCount: 0,
    providerFailed: false,
    providerSkippedReason: null,
  };
}

function incrementBlockedDiagnostic(
  diagnostics: SmartPicksAiGenerationDiagnostics,
  reason: SanitizePickBlockReason | null,
): void {
  if (reason === 'owned') {
    diagnostics.blockedOwnedCount += 1;
    return;
  }
  if (reason === 'budget') {
    diagnostics.blockedBudgetCount += 1;
    return;
  }
  if (reason === 'safety') {
    diagnostics.blockedSafetyCount += 1;
    return;
  }
  diagnostics.invalidPickCount += 1;
}

function sanitizeStarterTreatmentAssessment(
  context: SmartPicksContext,
  raw: RawStarterTreatmentAssessment,
): SmartPicksStarterTreatmentAssessment | null {
  const shouldRecommend = raw.shouldRecommend === true;
  const confidence = sanitizeStarterTreatmentConfidence(raw.confidence);
  const fallbackReason = shouldRecommend
    ? 'One gentle treatment may fit the stated goal once the starter basics are in place.'
    : 'Start with cleanser, moisturizer, and sunscreen before adding a treatment.';
  const reason =
    sanitizeString(sanitizeSkinToneCopy(raw.reason ?? ''), 260) ??
    fallbackReason;
  const sourceIds = mergeEvidenceSourceIds(
    sanitizeSourceIds(raw.sourceIds ?? []),
    shouldRecommend
      ? [SuggestionEvidenceSourceId.AadAcneTreatment]
      : [SuggestionEvidenceSourceId.MayoDrySkinCare],
  );

  if (!shouldRecommend) {
    return {
      shouldRecommend: false,
      ingredientOrCategory: null,
      goalAlignment: null,
      reason,
      sourceIds,
      confidence,
    };
  }

  const ingredientOrCategory = sanitizeString(
    sanitizeSkinToneCopy(raw.ingredientOrCategory ?? ''),
    160,
  );
  if (!ingredientOrCategory) return null;
  const goalAlignment = sanitizeString(
    sanitizeSkinToneCopy(raw.goalAlignment ?? ''),
    120,
  );
  const blockedTokens = blockedPreferenceTokens(context);
  const combinedText =
    `${ingredientOrCategory} ${goalAlignment ?? ''} ${reason}`.toLowerCase();
  if (containsBlockedPreference(combinedText, blockedTokens)) {
    return null;
  }
  if (
    isPregnancyCautionActive(context.skinProfile?.pregnancy_status ?? null) &&
    /(retinol|retinal|retinoid|tretinoin|adapalene)/i.test(combinedText)
  ) {
    return null;
  }

  return {
    shouldRecommend: true,
    ingredientOrCategory,
    goalAlignment,
    reason,
    sourceIds,
    confidence,
  };
}

function sanitizeSellerNames(sellerNames: string[]): string[] {
  const seenNames = new Set<string>();
  const sanitized: string[] = [];
  for (const sellerName of sellerNames) {
    const name = sanitizeString(sellerName, 80);
    const dedupeKey = name?.toLowerCase() ?? null;
    if (!name || !dedupeKey || seenNames.has(dedupeKey)) continue;
    seenNames.add(dedupeKey);
    sanitized.push(name);
    if (sanitized.length >= 3) break;
  }
  return sanitized;
}

function sanitizeReasoningChips(
  chips: SmartPicksReasoningChip[],
): SmartPicksReasoningChip[] {
  const allowedTones = new Set([
    'goal',
    'ethnicity',
    'compatibility',
    'location',
    'safety',
  ]);
  return chips
    .map((chip) => {
      const text = sanitizeString(chip.text, 70);
      if (
        !text ||
        !allowedTones.has(chip.tone) ||
        containsBudgetRationale(text)
      ) {
        return null;
      }
      return {
        tone: chip.tone,
        text: sanitizeSkinToneCopy(text),
        icon: sanitizeString(chip.icon, 30) ?? 'check',
      };
    })
    .filter((chip): chip is SmartPicksReasoningChip => Boolean(chip))
    .slice(0, 4);
}

function sanitizeSkinToneCopy(value: string): string {
  return value
    .replace(/trusted on melanin-rich skin/gi, 'PIH-aware')
    .replace(/suited to deeper skin tones/gi, 'white-cast checked')
    .replace(
      /for (black|asian|white|latino|hispanic|middle eastern) skin/gi,
      'skin-tone checked',
    );
}

function sanitizeReasoningFacts(
  facts: RawReasoningFacts,
): Record<string, string> {
  const entries = Array.isArray(facts)
    ? facts.map((fact) => [fact.label, fact.value])
    : Object.entries(facts);
  return Object.fromEntries(
    entries
      .map(([key, value]) => [
        sanitizeString(key, 40),
        sanitizeString(sanitizeSkinToneCopy(value ?? ''), 220),
      ])
      .filter((entry): entry is [string, string] => {
        const [key, value] = entry;
        return Boolean(
          key &&
          value &&
          !isCommerceReasoningFact([key, value]) &&
          !containsBudgetRationale(`${key} ${value}`),
        );
      })
      .slice(0, 8),
  );
}

function isCommerceReasoningFact([key, value]: [string, string]): boolean {
  return /\b(available|availability|stock|shipping|ships|delivery|price|prices|cost|currency|affiliate|purchase url|link|retailer)\b/i.test(
    `${key} ${value}`,
  );
}

function sanitizeRuledOut(
  ruledOut: SmartPicksRuledOutProduct[],
): SmartPicksRuledOutProduct[] {
  return ruledOut
    .map((item): SmartPicksRuledOutProduct | null => {
      const brand = sanitizeString(item.brand, 120);
      const productName = sanitizeString(item.productName, 200);
      const reason = sanitizeString(item.reason, 240);
      if (!brand || !productName || !reason) return null;
      return {
        brand,
        productName,
        reason: sanitizeSkinToneCopy(
          containsBudgetRationale(reason)
            ? 'Not the strongest fit for this profile.'
            : reason,
        ),
      };
    })
    .filter((item): item is SmartPicksRuledOutProduct => Boolean(item))
    .slice(0, 8);
}

function sanitizeSourceIds(
  sourceIds: SuggestionEvidenceSourceId[],
): SuggestionEvidenceSourceId[] {
  return sourceIds.filter((sourceId): sourceId is SuggestionEvidenceSourceId =>
    SOURCE_ID_ENUM.includes(sourceId),
  );
}

function sanitizeBudget(
  value: SmartPicksBudgetTier | null | undefined,
): SmartPicksBudgetTier | null {
  return ['drugstore', 'mid', 'premium', 'luxury'].includes(value ?? '')
    ? (value as SmartPicksBudgetTier)
    : null;
}

function sanitizeStarterTreatmentConfidence(
  value: string | null | undefined,
): SmartPicksStarterTreatmentConfidence {
  return SMART_PICKS_STARTER_TREATMENT_CONFIDENCES.includes(
    value as SmartPicksStarterTreatmentConfidence,
  )
    ? (value as SmartPicksStarterTreatmentConfidence)
    : 'low';
}

function isPregnancyCautionActive(status: string | null): boolean {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return false;
  return ![
    'not_pregnant',
    'not pregnant',
    'none',
    'no',
    'unknown',
    'prefer_not_to_say',
  ].includes(normalized);
}

function budgetAllowed(
  activeBudget: SmartPicksBudgetTier,
  pickBudget: SmartPicksBudgetTier,
): boolean {
  const order: SmartPicksBudgetTier[] = [
    'drugstore',
    'mid',
    'premium',
    'luxury',
  ];
  return order.indexOf(pickBudget) <= order.indexOf(activeBudget);
}

function sanitizeString(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized ? normalized.slice(0, maxLength) : null;
}

function sanitizeUserFacingReason(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const reason = sanitizeString(value, maxLength);
  if (!reason) return null;
  const withoutLeadIn = stripBudgetLeadIn(reason);
  if (containsBudgetRationale(withoutLeadIn)) return null;
  return withoutLeadIn;
}

function stripBudgetLeadIn(value: string): string {
  return capitalizeFirst(
    value
      .replace(
        /^Because\s+your\s+Skin\s+Profile\s+uses\s+an?\s+[a-z-]+\s+budget,\s*/i,
        '',
      )
      .replace(
        /^Best fit because (?:the )?profile is filtered to [a-z-]+ budget,\s*(?:and\s*)?/i,
        '',
      )
      .replace(
        /^because\s+your\s+budget\s+allows\s+a\s+more\s+complete\s+plan,\s*/i,
        '',
      )
      .replace(
        /\s+when\s+[a-z]+\s+and\s+safety\s+context\s+allow\s+it/gi,
        ' when the safety context allows it',
      )
      .replace(/^For\s+a\s+higher\s+[a-z]+,\s*/i, '')
      .replace(/^With\s+a\s+higher\s+[a-z]+,\s*/i, '')
      .trim(),
  );
}

function containsBudgetRationale(value: string): boolean {
  return /\b(budget|cheapest|price|cost|premium|luxury|drugstore)\b/i.test(
    value,
  );
}

function capitalizeFirst(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function productIdentityKey(brand: string, name: string): string {
  return `${brand} ${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function blockedPreferenceTokens(context: SmartPicksContext): string[] {
  const profile = context.skinProfile;
  const values = [
    ...(profile?.shopping_preferences?.ingredient_dislikes ?? []),
    ...(profile?.shopping_preferences?.product_dislikes ?? []),
    ...(profile?.shopping_preferences?.brand_dislikes ?? []),
    ...(profile?.reaction_history?.entries?.map((entry) => entry.trigger) ??
      []),
    ...Object.entries(profile?.active_tolerances ?? {})
      .filter(([, value]) =>
        ['cannot_use', 'sensitive_to_it'].includes(value.tolerance),
      )
      .map(([key]) => key),
  ];
  return values
    .map((value) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    )
    .filter((value) => value.length >= 3);
}

function containsBlockedPreference(
  value: string,
  blockedTokens: readonly string[],
): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return blockedTokens.some((token) =>
    containsUnsafePreferenceToken(normalized, token),
  );
}

function containsUnsafePreferenceToken(value: string, token: string): boolean {
  if (!value.includes(token)) return false;
  const tokenPattern = escapedTokenPattern(token);
  const directPattern = new RegExp(`\\b${tokenPattern}\\b`, 'i');
  if (!directPattern.test(value)) return false;
  const safePatterns = [
    new RegExp(`\\b${tokenPattern}\\s+free\\b`, 'i'),
    new RegExp(`\\bfree\\s+of\\s+${tokenPattern}\\b`, 'i'),
    new RegExp(`\\bwithout\\s+${tokenPattern}\\b`, 'i'),
    new RegExp(`\\bno\\s+${tokenPattern}\\b`, 'i'),
  ];
  return !safePatterns.some((pattern) => pattern.test(value));
}

function escapedTokenPattern(token: string): string {
  return token
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
}
