import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFeatureOpenAiModel } from '../../common/utils/openai-config';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { mergeEvidenceSourceIds } from '../../suggestions/services/suggestion-evidence-sources';
import {
  SMART_PICKS_AVAILABILITY_STATUSES,
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

@Injectable()
export class SmartPicksAiGenerator {
  private readonly logger = new Logger(SmartPicksAiGenerator.name);

  constructor(private readonly configService: ConfigService) {}

  async generate(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
  ): Promise<Map<string, GeneratedSmartPick>> {
    if (gaps.length === 0) return new Map();
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const model =
      readFeatureOpenAiModel(
        this.configService,
        SMART_PICKS_AI_MODEL_ENV_KEY,
        'gpt-4.1-mini',
      ) ?? 'gpt-4.1-mini';
    if (!apiKey || !model) {
      return new Map();
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
      if (!rawText) return new Map();
      const parsed = JSON.parse(rawText) as RawSmartPickResponse;
      return sanitizeGeneratedPicks(context, gaps, parsed);
    } catch (error) {
      this.logger.warn(
        `Smart Picks AI generation failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return new Map();
    }
  }
}

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
    'For replacement gaps, recommend a true replacement, not an add-on and not the same product. Explain in recommendationRankReason that the reason is logged use plus stalled photo/history signals, while avoiding diagnostic certainty.',
    'Photo and journal trends are decision support, not clinical proof. Never imply a product caused a reaction or failed; say the history suggests it may be time to consider a better-fitting replacement.',
    'For each gap, return one best product, up to two alternatives, retailer URLs if known, and 5-8 ruled-out products when possible.',
    'Keep copy short. Reasoning chips should be under 42 characters.',
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
): Map<string, GeneratedSmartPick> {
  const gapsByKey = new Map(gaps.map((gap) => [gap.normalizedKey, gap]));
  const ownedKeys = new Set(
    context.allProducts.map((product) =>
      productIdentityKey(product.brand, product.name),
    ),
  );
  const blockedTokens = blockedPreferenceTokens(context);
  const result = new Map<string, GeneratedSmartPick>();
  for (const rawGap of parsed.gaps ?? []) {
    const normalizedKey = sanitizeString(rawGap.normalizedKey, 180);
    if (!normalizedKey || !gapsByKey.has(normalizedKey)) continue;
    const pick = sanitizePick(rawGap, {
      context,
      ownedKeys,
      blockedTokens,
      fallbackSourceIds: gapsByKey.get(normalizedKey)?.sourceIds ?? [],
    });
    if (pick) result.set(normalizedKey, pick);
  }
  return result;
}

function sanitizePick(
  raw: RawSmartPickGap | RawSmartPickAlternative,
  options: {
    context: SmartPicksContext;
    ownedKeys: ReadonlySet<string>;
    blockedTokens: readonly string[];
    fallbackSourceIds: SuggestionEvidenceSourceId[];
  },
): GeneratedSmartPick | null {
  const brand = sanitizeString(raw.brand, 120);
  const productName = sanitizeString(raw.productName, 200);
  if (!brand || !productName) return null;
  const identityKey = productIdentityKey(brand, productName);
  if (options.ownedKeys.has(identityKey)) return null;
  const combinedText = `${brand} ${productName}`.toLowerCase();
  if (options.blockedTokens.some((token) => combinedText.includes(token))) {
    return null;
  }

  const budgetTier = sanitizeBudget(raw.budgetTier);
  if (
    options.context.budgetTier &&
    budgetTier &&
    !budgetAllowed(options.context.budgetTier, budgetTier)
  ) {
    return null;
  }

  const retailers = sanitizeRetailers(raw.retailers ?? []);
  const availabilityStatus = sanitizeAvailabilityStatus(raw.availabilityStatus);
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
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
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
