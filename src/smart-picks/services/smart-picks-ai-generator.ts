import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFeatureOpenAiModel } from '../../common/utils/openai-config';
import { isSafeExternalHttpUrl } from '../../common/utils/url-security';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { mergeEvidenceSourceIds } from '../../suggestions/services/suggestion-evidence-sources';
import {
  SMART_PICKS_AVAILABILITY_STATUSES,
  SmartPicksAvailabilityStatus,
  SmartPicksBudgetTier,
  SmartPicksGapSnapshot,
  SmartPicksProductPerformanceSignal,
  SmartPicksProductPick,
  SmartPicksReasoningChip,
  SmartPicksRetailer,
  SmartPicksRuledOutProduct,
} from '../smart-picks.types';
import { SmartPicksContext } from './smart-picks-context-builder';

export const SMART_PICKS_AI_MODEL_ENV_KEY = 'SMART_PICKS_AI_MODEL';
const SMART_PICKS_AI_TIMEOUT_MS = 45_000;
const SMART_PICKS_AI_MAX_OUTPUT_TOKENS = 2200;
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
  priceCents?: number | null;
  currency?: string | null;
  availabilityStatus?: string | null;
  recommendationRankReason?: string | null;
  localAlternativeReason?: string | null;
  retailers?: SmartPicksRetailer[];
  reasoningChips?: SmartPicksReasoningChip[];
  reasoningFacts?: Record<string, string>;
  ruledOut?: SmartPicksRuledOutProduct[];
  alternatives?: RawSmartPickAlternative[];
  sourceIds?: SuggestionEvidenceSourceId[];
};

type RawSmartPickAlternative = Omit<RawSmartPickGap, 'normalizedKey'>;

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
  | 'id'
  | 'userAction'
  | 'createdAt'
  | 'alternatives'
  | 'retailerDataCheckedAt'
  | 'retailerDataStale'
> & {
  alternatives: GeneratedSmartPickAlternative[];
};

type GeneratedSmartPickAlternative = Omit<
  SmartPicksProductPick,
  | 'id'
  | 'userAction'
  | 'createdAt'
  | 'alternatives'
  | 'retailerDataCheckedAt'
  | 'retailerDataStale'
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
          `OpenAI starter treatment call failed (${response.status}).`,
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
        throw new Error(`OpenAI Smart Picks call failed (${response.status}).`);
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
  'You decide whether Ritora Starter Kit should include one beginner treatment step now.',
  'The starter essentials are cleanser, moisturizer, and sunscreen. A treatment belongs only when the profile goal, concern details, tolerance, history, and safety context justify it.',
  'Use AI judgment, but be conservative: recommend treatment only when it is clearly tied to the user goal, and wait when the user only wants a basic routine.',
  'Return a product type or key ingredient category, not a brand or exact product.',
  'Never diagnose, treat, cure, or prescribe. Photo and journal trends are only decision support.',
  'Respect disliked ingredients, known reaction triggers, active tolerances, pregnancy status, and dermatologist-care context.',
  'Reasoning about skin tone must be concrete and cautious: use phrases such as PIH-aware, white-cast checked, low-irritation intro, or tint/finish checked. Do not say trusted on an ethnicity or suited to a race.',
  'Return strictly valid JSON matching the schema.',
].join(' ');

const SYSTEM_PROMPT = [
  'You are the Smart Picks product suggestion engine for Ritora.',
  'Ritora is inventory-first: recommend a purchase only when a real shelf gap exists.',
  'Return external product suggestions only. Do not claim Ritora has verified stock, efficacy, reviews, or local availability unless the retailer URL supports it.',
  'Rank product fit before local availability. The best pick can be import-only or locally unavailable when it better fits the user goal, budget, skin profile, and shelf compatibility.',
  'If the best product is not locally available in the user country, set availabilityStatus accordingly, include at least one local alternative when possible, and explain why the local alternative may be less ideal.',
  'Never diagnose, treat, cure, or prescribe. Use cautious skincare-app wording.',
  'Reasoning about skin tone must be concrete and cautious: use phrases such as PIH-aware, white-cast checked, low-irritation intro, or tint/finish checked. Do not say trusted on an ethnicity or suited to a race.',
  'Never recommend products matching owned products, disliked ingredients, disliked brands, or known reaction triggers supplied by the user.',
  'Affiliate eligibility must not affect ranking. Retailer links may be affiliate eligible, but disclosures are handled by the app.',
  'Return strictly valid JSON matching the schema.',
].join(' ');

const GOAL_SPECIFIC_STARTER_PICK_GUIDANCE = [
  'Goal-specific starter pick guidance:',
  '- dark marks or hyperpigmentation: prioritize pigment-supporting products such as azelaic acid, tranexamic acid, vitamin C/ascorbic derivatives, kojic acid, alpha arbutin, or a beginner retinoid when the safety context allows; do not satisfy this gap with a generic glow moisturizer.',
  '- acne or breakouts: prioritize one low-irritation acne treatment such as azelaic acid, salicylic acid/BHA, benzoyl peroxide, or an appropriate retinoid.',
  '- rough texture or clogged pores: prioritize gentle AHA/PHA/BHA texture support and explain sunscreen sensitivity when relevant.',
  '- redness, sensitivity, or barrier repair: prioritize calming barrier support such as niacinamide, panthenol, centella, or bland barrier-support products; avoid exfoliating acids unless the profile clearly tolerates them.',
  '- hydration: prioritize humectant or barrier-hydration support such as glycerin, hyaluronic acid, beta-glucan, panthenol, or urea.',
  '- fine lines or firmness: prioritize a gentle retinoid/retinal night product when safe; use a peptide or bakuchiol-style option when retinoids are not suitable.',
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
            'priceCents',
            'currency',
            'availabilityStatus',
            'recommendationRankReason',
            'localAlternativeReason',
            'retailers',
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
            priceCents: { type: ['integer', 'null'] },
            currency: { type: ['string', 'null'] },
            availabilityStatus: {
              type: 'string',
              enum: SMART_PICKS_AVAILABILITY_STATUSES,
            },
            recommendationRankReason: { type: ['string', 'null'] },
            localAlternativeReason: { type: ['string', 'null'] },
            retailers: retailerArraySchema(),
            reasoningChips: reasoningChipArraySchema(),
            reasoningFacts: {
              type: 'object',
              additionalProperties: { type: 'string' },
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
                  'priceCents',
                  'currency',
                  'availabilityStatus',
                  'recommendationRankReason',
                  'localAlternativeReason',
                  'retailers',
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
                  priceCents: { type: ['integer', 'null'] },
                  currency: { type: ['string', 'null'] },
                  availabilityStatus: {
                    type: 'string',
                    enum: SMART_PICKS_AVAILABILITY_STATUSES,
                  },
                  recommendationRankReason: { type: ['string', 'null'] },
                  localAlternativeReason: { type: ['string', 'null'] },
                  retailers: retailerArraySchema(),
                  reasoningChips: reasoningChipArraySchema(),
                  reasoningFacts: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
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

function retailerArraySchema() {
  return {
    type: 'array',
    maxItems: 4,
    items: {
      type: 'object',
      additionalProperties: false,
      required: [
        'name',
        'url',
        'priceCents',
        'currency',
        'inStock',
        'isAffiliate',
      ],
      properties: {
        name: { type: 'string' },
        url: { type: 'string' },
        priceCents: { type: ['integer', 'null'] },
        currency: { type: ['string', 'null'] },
        inStock: { type: 'boolean' },
        isAffiliate: { type: 'boolean' },
      },
    },
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
    maxItems: 8,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['brand', 'productName', 'priceCents', 'currency', 'reason'],
      properties: {
        brand: { type: 'string' },
        productName: { type: 'string' },
        priceCents: { type: ['integer', 'null'] },
        currency: { type: ['string', 'null'] },
        reason: { type: 'string' },
      },
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
    `Location: city=${profile?.city ?? '?'}, country=${profile?.country_code ?? '?'}.`,
    `Skin profile: type=${profile?.skin_type ?? '?'}, tone=${profile?.skin_tone ?? '?'}, ethnicity=${profile?.ethnicity ?? '?'}, primaryGoal=${profile?.primary_goal ?? '?'}, concerns=${(profile?.current_concerns ?? []).join(', ') || 'none'}.`,
    `Safety and preferences: ${JSON.stringify(buildSafetyAndPreferenceSummary(context))}`,
    `Shelf products to avoid recommending again:\n${context.allProducts.map(formatProduct).join('\n') || '(none)'}`,
    `Product performance summary:\n${formatProductPerformance(context)}`,
    `Gaps needing product picks:\n${gaps.map((gap) => `- key=${gap.normalizedKey}; kind=${gap.gapKind}; priority=${gap.priority}; category=${gap.ingredientOrCategory}; reason=${gap.reason}; replacementFor=${gap.replacementFor ? `${gap.replacementFor.productName}; usageDaysLast90=${gap.replacementFor.usageDaysLast90}; photoCheckpoints=${gap.replacementFor.photoCheckpoints}; reactionSignalCount=${gap.replacementFor.reactionSignalCount}` : 'none'}; sourceIds=${gap.sourceIds.join(',')}`).join('\n')}`,
    'Rank product fit before local availability. Use availabilityStatus=local only when the product has a plausible retailer in the user country. Use import_only when it ships internationally, unavailable when no purchase path is known for the user country, and unknown when availability is unclear.',
    'If the best product is not locally available, put the strongest locally available fallback first in alternatives and fill localAlternativeReason with a cautious reason it may not match the top pick as closely.',
    GOAL_SPECIFIC_STARTER_PICK_GUIDANCE,
    'For replacement gaps, recommend a true replacement, not an add-on and not the same product. Explain in recommendationRankReason that the reason is logged use plus stalled photo/history signals, while avoiding diagnostic certainty.',
    'Photo and journal trends are decision support, not clinical proof. Never imply a product caused a reaction or failed; say the history suggests it may be time to consider a better-fitting replacement.',
    'For each gap, return one best product, up to two alternatives, retailer URLs if known, and 5-8 ruled-out products when possible.',
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
    const normalizedKey = sanitizeString(rawGap.normalizedKey, 180);
    if (!normalizedKey || !gapsByKey.has(normalizedKey)) {
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
  if (
    options.context.budgetTier &&
    budgetTier &&
    !budgetAllowed(options.context.budgetTier, budgetTier)
  ) {
    return blockedPick('budget');
  }

  const retailers = sanitizeRetailers(raw.retailers ?? []);
  const availabilityStatus = normalizeAvailabilityWithRetailers(
    sanitizeAvailabilityStatus(raw.availabilityStatus),
    retailers,
  );
  const recommendationRankReason = sanitizeString(
    raw.recommendationRankReason,
    260,
  );
  const localAlternativeReason = sanitizeString(
    raw.localAlternativeReason,
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
      priceCents: pick.priceCents,
      currency: pick.currency,
      retailers: pick.retailers,
      reasoningChips: pick.reasoningChips,
      reasoningFacts: pick.reasoningFacts,
      ruledOut: pick.ruledOut,
      sourceIds: pick.sourceIds,
      verificationStatus: pick.verificationStatus,
      availabilityStatus: pick.availabilityStatus,
      recommendationRankReason: pick.recommendationRankReason,
      localAlternativeReason: pick.localAlternativeReason,
      alternatives: [],
    }));

  return {
    pick: {
      brand,
      productName,
      budgetTier,
      priceCents: sanitizePrice(raw.priceCents),
      currency: sanitizeCurrency(raw.currency),
      retailers,
      reasoningChips: sanitizeReasoningChips(raw.reasoningChips ?? []),
      reasoningFacts: sanitizeReasoningFacts(raw.reasoningFacts ?? {}),
      ruledOut: sanitizeRuledOut(raw.ruledOut ?? []),
      sourceIds: mergeEvidenceSourceIds(
        sanitizeSourceIds(raw.sourceIds ?? []),
        options.fallbackSourceIds,
      ),
      alternatives,
      verificationStatus: 'ai_named',
      availabilityStatus,
      recommendationRankReason,
      localAlternativeReason,
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
    context.skinProfile?.pregnancy_status &&
    /(retinol|retinoid|tretinoin|adapalene)/i.test(combinedText)
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

function sanitizeRetailers(
  retailers: SmartPicksRetailer[],
): SmartPicksRetailer[] {
  return retailers
    .map((retailer) => {
      const url = sanitizeUrl(retailer.url);
      const name = sanitizeString(retailer.name, 80);
      if (!url || !name) return null;
      return {
        name,
        url,
        priceCents: sanitizePrice(retailer.priceCents),
        currency: sanitizeCurrency(retailer.currency),
        inStock: Boolean(retailer.inStock),
        isAffiliate: Boolean(retailer.isAffiliate),
      };
    })
    .filter((retailer): retailer is SmartPicksRetailer => Boolean(retailer))
    .slice(0, 4);
}

function sanitizeReasoningChips(
  chips: SmartPicksReasoningChip[],
): SmartPicksReasoningChip[] {
  const allowedTones = new Set([
    'goal',
    'budget',
    'ethnicity',
    'compatibility',
    'location',
    'safety',
  ]);
  return chips
    .map((chip) => {
      const text = sanitizeString(chip.text, 70);
      if (!text || !allowedTones.has(chip.tone)) return null;
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
  facts: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(facts)
      .map(([key, value]) => [
        sanitizeString(key, 40),
        sanitizeString(sanitizeSkinToneCopy(value), 220),
      ])
      .filter((entry): entry is [string, string] =>
        Boolean(entry[0] && entry[1]),
      )
      .slice(0, 8),
  );
}

function sanitizeRuledOut(
  ruledOut: SmartPicksRuledOutProduct[],
): SmartPicksRuledOutProduct[] {
  return ruledOut
    .map((item) => {
      const brand = sanitizeString(item.brand, 120);
      const productName = sanitizeString(item.productName, 200);
      const reason = sanitizeString(item.reason, 240);
      if (!brand || !productName || !reason) return null;
      return {
        brand,
        productName,
        priceCents: sanitizePrice(item.priceCents),
        currency: sanitizeCurrency(item.currency),
        reason: sanitizeSkinToneCopy(reason),
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

function sanitizeAvailabilityStatus(
  value: string | null | undefined,
): (typeof SMART_PICKS_AVAILABILITY_STATUSES)[number] {
  return SMART_PICKS_AVAILABILITY_STATUSES.includes(
    value as (typeof SMART_PICKS_AVAILABILITY_STATUSES)[number],
  )
    ? (value as (typeof SMART_PICKS_AVAILABILITY_STATUSES)[number])
    : 'unknown';
}

function normalizeAvailabilityWithRetailers(
  availabilityStatus: SmartPicksAvailabilityStatus,
  retailers: readonly SmartPicksRetailer[],
): SmartPicksAvailabilityStatus {
  if (availabilityStatus === 'local' && retailers.length === 0) {
    return 'unknown';
  }
  if (availabilityStatus === 'unavailable' && retailers.length > 0) {
    return 'unknown';
  }
  return availabilityStatus;
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

function sanitizePrice(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 0 && value <= 1_000_000 ? value : null;
}

function sanitizeCurrency(value: string | null | undefined): string | null {
  const normalized = sanitizeString(value, 3)?.toUpperCase() ?? null;
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function sanitizeString(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized ? normalized.slice(0, maxLength) : null;
}

function sanitizeUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    return isSafeExternalHttpUrl(parsed.toString()) ? parsed.toString() : null;
  } catch {
    return null;
  }
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
