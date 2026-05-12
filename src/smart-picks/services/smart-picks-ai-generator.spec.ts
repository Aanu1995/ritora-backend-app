import { ConfigService } from '@nestjs/config';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { User } from '../../users/entities/user.entity';
import {
  SmartPicksGapKind,
  SmartPicksGapSnapshot,
  SmartPicksProductAdherence,
  SmartPicksProductPerformanceSignal,
} from '../smart-picks.types';
import { SmartPicksContext } from './smart-picks-context-builder';
import { SmartPicksAiGenerator } from './smart-picks-ai-generator';

describe('SmartPicksAiGenerator', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sanitizes AI product picks before persistence or display', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'broad-spectrum-sunscreen-spf-30',
            brand: 'Good Brand',
            productName: 'Mineral SPF 50',
            budgetTier: 'mid',
            priceCents: 2200,
            currency: 'usd',
            availabilityStatus: 'import_only',
            recommendationRankReason:
              'Best fit comes first because the finish and irritation profile suit the user goal.',
            localAlternativeReason:
              'The local option is easier to buy but has a less elegant finish history.',
            retailers: [
              {
                name: 'Derm Store',
                url: 'https://example.com/spf',
                priceCents: 2200,
                currency: 'usd',
                inStock: true,
                isAffiliate: true,
              },
              {
                name: 'Bad Link',
                url: 'javascript:alert(1)',
                priceCents: 2100,
                currency: 'usd',
                inStock: true,
                isAffiliate: false,
              },
            ],
            reasoningChips: [
              {
                tone: 'ethnicity',
                text: 'Trusted on melanin-rich skin',
                icon: 'sparkle',
              },
            ],
            reasoningFacts: {
              tone: 'Suited to deeper skin tones in finish checks.',
            },
            ruledOut: [
              {
                brand: 'Too Much',
                productName: 'Premium SPF',
                priceCents: 6800,
                currency: 'usd',
                reason: 'Outside selected budget.',
              },
            ],
            alternatives: [
              {
                brand: 'Local Brand',
                productName: 'Local SPF 50',
                budgetTier: 'mid',
                priceCents: 1800,
                currency: 'usd',
                availabilityStatus: 'local',
                recommendationRankReason:
                  'Easier local access, but less targeted than the top pick.',
                localAlternativeReason: null,
                retailers: [
                  {
                    name: 'Local Pharmacy',
                    url: 'https://example.com/local-spf',
                    priceCents: 1800,
                    currency: 'usd',
                    inStock: true,
                    isAffiliate: false,
                  },
                ],
                reasoningChips: [
                  { tone: 'location', text: 'Available locally', icon: 'map' },
                ],
                reasoningFacts: {
                  availability: 'Ships in the user country.',
                },
                ruledOut: [],
                sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
              },
            ],
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
          },
          {
            normalizedKey: 'gentle-cleanser',
            brand: 'Owned Brand',
            productName: 'Owned Cleanser',
            budgetTier: 'drugstore',
            priceCents: 900,
            currency: 'usd',
            availabilityStatus: 'local',
            recommendationRankReason: 'Owned duplicate.',
            localAlternativeReason: null,
            retailers: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [],
            sourceIds: [],
          },
          {
            normalizedKey: 'barrier-support-moisturizer',
            brand: 'Luxury Brand',
            productName: 'Premium Barrier Cream',
            budgetTier: 'premium',
            priceCents: 7200,
            currency: 'usd',
            availabilityStatus: 'local',
            recommendationRankReason: 'Outside budget.',
            localAlternativeReason: null,
            retailers: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [],
            sourceIds: [],
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const picks = await generator.generate(context(), gaps());

    expect(picks.has('gentle-cleanser')).toBe(false);
    expect(picks.has('barrier-support-moisturizer')).toBe(false);
    expect(picks.get('broad-spectrum-sunscreen-spf-30')).toEqual(
      expect.objectContaining({
        brand: 'Good Brand',
        productName: 'Mineral SPF 50',
        budgetTier: 'mid',
        currency: 'USD',
        retailers: [
          {
            name: 'Derm Store',
            url: 'https://example.com/spf',
            priceCents: 2200,
            currency: 'USD',
            inStock: true,
            isAffiliate: true,
          },
        ],
        reasoningChips: [
          {
            tone: 'ethnicity',
            text: 'PIH-aware',
            icon: 'sparkle',
          },
        ],
        reasoningFacts: {
          tone: 'white-cast checked in finish checks.',
        },
        availabilityStatus: 'import_only',
        recommendationRankReason:
          'Best fit comes first because the finish and irritation profile suit the user goal.',
        localAlternativeReason:
          'The local option is easier to buy but has a less elegant finish history.',
        alternatives: [
          expect.objectContaining({
            brand: 'Local Brand',
            productName: 'Local SPF 50',
            availabilityStatus: 'local',
          }),
        ],
        verificationStatus: 'ai_named',
      }),
    );
    const rawRequestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof rawRequestBody).toBe('string');
    const requestBody = JSON.parse(rawRequestBody as string) as {
      input?: { content?: { text?: string }[] }[];
    };
    const userPrompt = requestBody.input?.[1]?.content?.[0]?.text ?? '';
    expect(userPrompt).toContain('Rank product fit before local availability.');
    expect(userPrompt).toContain(
      'If the best product is not locally available',
    );
    expect(userPrompt).toContain('Product performance summary');
    expect(userPrompt).toContain('usageDaysLast90');
    expect(userPrompt).toContain(
      'For replacement gaps, recommend a true replacement',
    );
    expect(userPrompt).toContain(
      'Photo and journal trends are decision support, not clinical proof',
    );
    expect(userPrompt).toContain(
      'Never imply a product caused a reaction or failed',
    );
  });

  it('does not call the AI provider when no API key is configured', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    const generator = new SmartPicksAiGenerator(configService(null));

    await expect(generator.generate(context(), gaps())).resolves.toEqual(
      new Map(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function openAiResponse(body: unknown): Response {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify(body),
            },
          ],
        },
      ],
    }),
  } as unknown as Response;
}

function configService(apiKey: string | null = 'test-key'): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'OPENAI_API_KEY') return apiKey;
      return undefined;
    }),
  } as unknown as ConfigService;
}

function context(): SmartPicksContext {
  return {
    user: { id: 'user-1', time_zone: 'Europe/Stockholm' } as User,
    skinProfile: {
      user_id: 'user-1',
      skin_type: 'combination',
      skin_tone: 'deep',
      ethnicity: 'Yoruba',
      current_concerns: ['dark marks'],
      primary_goal: 'fade dark marks',
      country_code: 'US',
      city: 'New York',
      shopping_preferences: {
        ingredient_dislikes: [],
        product_dislikes: [],
        brand_dislikes: [],
      },
      reaction_history: { entries: [] },
      active_tolerances: {},
      pregnancy_status: null,
      under_dermatologist_care: null,
      allow_smart_picks: true,
    } as unknown as SkinProfile,
    skinProfileRequired: false,
    missingProfileFields: [],
    consentRequired: false,
    activeProducts: [ownedProduct()],
    allProducts: [ownedProduct()],
    environment: null,
    budgetTier: 'mid',
    mode: 'refine',
    inputsHash: 'hash-1',
    productPerformance: [
      {
        productId: 'owned-1',
        brand: 'Owned Brand',
        productName: 'Owned Cleanser',
        category: ProductCategory.Cleanser,
        usageDaysLast30: 12,
        usageDaysLast90: 38,
        firstUsedAt: '2026-02-21',
        lastUsedAt: '2026-05-10',
        adherence: SmartPicksProductAdherence.Consistent,
        goalTrend: SmartPicksProductPerformanceSignal.NotImproving,
        concernTrend: 'hyperpigmentation',
        photoCheckpoints: 2,
        reactionSignalCount: 0,
        replacementCandidate: true,
        replacementReason:
          '38 logged use days and photo history still shows hyperpigmentation.',
      },
    ],
  };
}

function gaps(): SmartPicksGapSnapshot[] {
  return [
    gap('Broad-spectrum sunscreen SPF 30+', 'broad-spectrum-sunscreen-spf-30'),
    gap('Gentle cleanser', 'gentle-cleanser'),
    gap('Barrier-support moisturizer', 'barrier-support-moisturizer'),
  ];
}

function gap(
  ingredientOrCategory: string,
  normalizedKey: string,
): SmartPicksGapSnapshot {
  return {
    ingredientOrCategory,
    normalizedKey,
    priority: 'priority',
    reason: 'Missing from shelf.',
    goalAlignment: 'sun protection',
    sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    gapKind: SmartPicksGapKind.Missing,
    replacementFor: null,
  };
}

function ownedProduct(): InventoryProduct {
  return {
    id: 'owned-1',
    user_id: 'user-1',
    brand: 'Owned Brand',
    name: 'Owned Cleanser',
    category: ProductCategory.Cleanser,
    status: ShelfStatus.Active,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    identity: { inciIngredients: [] },
  } as unknown as InventoryProduct;
}
