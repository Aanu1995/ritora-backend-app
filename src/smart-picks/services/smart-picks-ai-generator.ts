import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFeatureOpenAiModel } from '../../common/utils/openai-config';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { mergeEvidenceSourceIds } from '../../suggestions/services/suggestion-evidence-sources';
import { normalizeSuggestionGapKey } from '../../suggestions/services/suggestion-gap-actions';
import {
  SmartPicksBudgetTier,
  SmartPicksGapSnapshot,
  SmartPicksProductPerformanceSignal,
  SmartPicksProductPick,
  SmartPicksReasoningChip,
  SmartPicksRuledOutProduct,
} from '../smart-picks.types';
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

type SanitizePickBlockReason = 'invalid' | 'owned' | 'budget' | 'safety';

type SanitizePickResult = {
  pick: GeneratedSmartPick | null;
  blockReason: SanitizePickBlockReason | null;
};

@Injectable()
export class SmartPicksAiGenerator {
  private readonly logger = new Logger(SmartPicksAiGenerator.name);

  constructor(private readonly configService: ConfigService) {}

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
  if (!brand || !productName) return blockedPick('invalid');
  const identityKey = productIdentityKey(brand, productName);
  if (options.ownedKeys.has(identityKey)) return blockedPick('owned');
  const combinedText = `${brand} ${productName}`.toLowerCase();
  if (options.blockedTokens.some((token) => combinedText.includes(token))) {
    return blockedPick('safety');
  }

  const budgetTier = sanitizeBudget(raw.budgetTier);
  if (options.context.budgetTier && !budgetTier) {
    return blockedPick('budget');
  }
  if (
    options.context.budgetTier &&
    budgetTier &&
    !budgetAllowed(options.context.budgetTier, budgetTier)
  ) {
    return blockedPick('budget');
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
  if (blockedTokens.some((token) => combinedText.includes(token))) {
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
