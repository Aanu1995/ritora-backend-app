import { ConfigService } from '@nestjs/config';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { User } from '../../users/entities/user.entity';
import {
  SmartPicksGapKind,
  SmartPicksGapSnapshot,
  SmartPicksBudgetTier,
  SmartPicksProductAdherence,
  SmartPicksProductPerformanceSignal,
} from '../smart-picks.types';
import { SmartPicksContext } from './smart-picks-context-builder';
import {
  SmartPicksAiGenerator,
  SmartPicksAiProviderSkippedReason,
} from './smart-picks-ai-generator';

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

    const result = await generator.generateWithDiagnostics(context(), gaps());
    const picks = result.picks;

    expect(picks.has('gentle-cleanser')).toBe(false);
    expect(picks.has('barrier-support-moisturizer')).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        requestedGapCount: 3,
        rawGapCount: 3,
        acceptedPickCount: 1,
        blockedOwnedCount: 1,
        blockedBudgetCount: 1,
        blockedSafetyCount: 0,
        invalidPickCount: 0,
        missingPickCount: 2,
      }),
    );
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
    expect(userPrompt).toContain('Goal-specific starter pick guidance');
    expect(userPrompt).toContain(
      'dark marks or hyperpigmentation: prioritize pigment-supporting products',
    );
  });

  it('does not call the AI provider when no API key is configured', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    const generator = new SmartPicksAiGenerator(configService(null));

    await expect(generator.generate(context(), gaps())).resolves.toEqual(
      new Map(),
    );
    await expect(
      generator.generateWithDiagnostics(context(), gaps()),
    ).resolves.toEqual({
      picks: new Map(),
      diagnostics: expect.objectContaining({
        requestedGapCount: 3,
        providerSkippedReason: SmartPicksAiProviderSkippedReason.MissingApiKey,
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports provider failures without leaking product identifiers', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn(),
    } as unknown as Response);
    const generator = new SmartPicksAiGenerator(configService());

    const result = await generator.generateWithDiagnostics(context(), gaps());

    expect(result.picks).toEqual(new Map());
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        requestedGapCount: 3,
        providerFailed: true,
        providerSkippedReason: null,
        missingPickCount: 3,
      }),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain('Mineral SPF');
    expect(JSON.stringify(result.diagnostics)).not.toContain('example.com');
  });

  it('counts unsafe AI product output blocked by user preferences', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'broad-spectrum-sunscreen-spf-30',
            brand: 'Retinol Brand',
            productName: 'Retinol SPF',
            budgetTier: 'mid',
            priceCents: 2200,
            currency: 'usd',
            availabilityStatus: 'local',
            recommendationRankReason: 'Unsafe preference mismatch.',
            localAlternativeReason: null,
            retailers: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [],
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
          },
        ],
      }),
    );
    const unsafeContext = context();
    const currentProfile = unsafeContext.skinProfile;
    if (!currentProfile) throw new Error('Expected skin profile fixture.');
    unsafeContext.skinProfile = {
      ...currentProfile,
      shopping_preferences: {
        ingredient_dislikes: ['retinol'],
        product_dislikes: [],
        brand_dislikes: [],
      },
    } as unknown as SkinProfile;
    const generator = new SmartPicksAiGenerator(configService());

    const result = await generator.generateWithDiagnostics(unsafeContext, [
      gap(
        'Broad-spectrum sunscreen SPF 30+',
        'broad-spectrum-sunscreen-spf-30',
      ),
    ]);

    expect(result.picks).toEqual(new Map());
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        rawGapCount: 1,
        blockedSafetyCount: 1,
        missingPickCount: 1,
      }),
    );
  });

  it.each([
    {
      label: 'Sweden, mid budget, melanin-rich dark marks',
      profile: {
        country_code: 'SE',
        city: 'Stockholm',
        ethnicity: 'Yoruba',
        skin_tone: 'deep',
        primary_goal: 'fade dark marks',
        current_concerns: ['hyperpigmentation'],
        budget_tier: 'mid',
      },
      gapFixture: gap(
        'Azelaic acid or tranexamic acid dark-spot serum',
        'azelaic-acid-or-tranexamic-acid-dark-spot-serum',
      ),
      aiGap: {
        normalizedKey: 'azelaic-acid-or-tranexamic-acid-dark-spot-serum',
        brand: 'K-Beauty Brand',
        productName: 'Azelaic Calm Serum',
        budgetTier: 'mid',
        priceCents: 2400,
        currency: 'eur',
        availabilityStatus: 'import_only',
        recommendationRankReason:
          'Best fit for PIH support, even though it may need importing.',
        localAlternativeReason:
          'The local option is easier to buy but may be less targeted.',
        retailers: [
          {
            name: 'Korean Retailer',
            url: 'https://example.com/kr-serum',
            priceCents: 2400,
            currency: 'eur',
            inStock: true,
            isAffiliate: false,
          },
        ],
        reasoningChips: [
          {
            tone: 'ethnicity',
            text: 'Trusted on melanin-rich skin',
            icon: 'check',
          },
        ],
        reasoningFacts: { tone: 'Suited to deeper skin tones.' },
        ruledOut: [],
        alternatives: [
          {
            brand: 'Local Pharmacy',
            productName: 'Tone Serum',
            budgetTier: 'mid',
            priceCents: 1800,
            currency: 'eur',
            availabilityStatus: 'local',
            recommendationRankReason: 'Local fallback.',
            localAlternativeReason: null,
            retailers: [
              {
                name: 'Local Shop',
                url: 'https://example.com/local-tone',
                priceCents: 1800,
                currency: 'eur',
                inStock: true,
                isAffiliate: false,
              },
            ],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
          },
        ],
        sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
      },
      expected: {
        pickName: 'Azelaic Calm Serum',
        availabilityStatus: 'import_only',
        diagnosticKey: 'acceptedPickCount',
        diagnosticValue: 1,
      },
    },
    {
      label: 'US, drugstore budget, acne',
      profile: {
        country_code: 'US',
        city: 'Atlanta',
        ethnicity: 'African American',
        skin_tone: 'deep',
        primary_goal: 'calm breakouts',
        current_concerns: ['acne'],
        budget_tier: 'drugstore',
      },
      gapFixture: gap(
        'Low-irritation acne treatment with azelaic acid or BHA',
        'low-irritation-acne-treatment-with-azelaic-acid-or-bha',
      ),
      aiGap: {
        normalizedKey: 'low-irritation-acne-treatment-with-azelaic-acid-or-bha',
        brand: 'Premium Brand',
        productName: 'Acne Gel',
        budgetTier: 'premium',
        priceCents: 6800,
        currency: 'usd',
        availabilityStatus: 'local',
        recommendationRankReason: 'Outside budget.',
        localAlternativeReason: null,
        retailers: [],
        reasoningChips: [],
        reasoningFacts: {},
        ruledOut: [],
        alternatives: [],
        sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
      },
      expected: {
        pickName: null,
        availabilityStatus: null,
        diagnosticKey: 'blockedBudgetCount',
        diagnosticValue: 1,
      },
    },
  ])(
    'keeps AI product behavior inside golden persona guardrails: $label',
    async ({ profile, gapFixture, aiGap, expected }) => {
      const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock;
      fetchMock.mockResolvedValue(openAiResponse({ gaps: [aiGap] }));
      const generator = new SmartPicksAiGenerator(configService());
      const budgetTier = profile.budget_tier as SmartPicksBudgetTier;
      const personaContext = context({
        skinProfile: {
          ...context().skinProfile,
          ...profile,
          budget_tier: budgetTier,
        } as unknown as SkinProfile,
        budgetTier,
      });

      const result = await generator.generateWithDiagnostics(personaContext, [
        gapFixture,
      ]);

      const pick = result.picks.get(gapFixture.normalizedKey);
      expect(pick?.productName ?? null).toBe(expected.pickName);
      expect(pick?.availabilityStatus ?? null).toBe(
        expected.availabilityStatus,
      );
      expect(
        result.diagnostics[
          expected.diagnosticKey as keyof typeof result.diagnostics
        ],
      ).toBe(expected.diagnosticValue);
      expect(JSON.stringify(pick ?? {})).not.toContain(
        'Trusted on melanin-rich skin',
      );
      expect(JSON.stringify(pick ?? {})).not.toContain(
        'Suited to deeper skin tones',
      );
    },
  );

  it('asks AI whether a starter routine needs one treatment step', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        shouldRecommend: true,
        ingredientOrCategory: 'PIH-aware azelaic acid serum',
        goalAlignment: 'dark mark support',
        reason:
          'Your profile points to stubborn dark marks, so one gentle treatment belongs after cleanser, moisturizer, and sunscreen.',
        sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
        confidence: 'high',
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const assessment = await generator.assessStarterTreatment({
      ...context(),
      mode: 'starter',
      activeProducts: [],
      allProducts: [],
    });

    expect(assessment).toEqual({
      shouldRecommend: true,
      ingredientOrCategory: 'PIH-aware azelaic acid serum',
      goalAlignment: 'dark mark support',
      reason:
        'Your profile points to stubborn dark marks, so one gentle treatment belongs after cleanser, moisturizer, and sunscreen.',
      sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
      confidence: 'high',
    });
    const rawRequestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof rawRequestBody).toBe('string');
    const requestBody = JSON.parse(rawRequestBody as string) as {
      input?: { content?: { text?: string }[] }[];
    };
    const userPrompt = requestBody.input?.[1]?.content?.[0]?.text ?? '';
    expect(userPrompt).toContain('Starter treatment assessment');
    expect(userPrompt).toContain('Product performance summary');
    expect(userPrompt).not.toContain('user-1');
  });

  it('drops unsafe AI starter treatment assessments before they can become gaps', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        shouldRecommend: true,
        ingredientOrCategory: 'Retinol serum',
        goalAlignment: 'fine line support',
        reason: 'Retinol may help the goal.',
        sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
        confidence: 'medium',
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());
    const unsafeContext = context();
    const currentProfile = unsafeContext.skinProfile;
    if (!currentProfile) throw new Error('Expected skin profile fixture.');
    unsafeContext.skinProfile = {
      ...currentProfile,
      shopping_preferences: {
        ingredient_dislikes: ['retinol'],
        product_dislikes: [],
        brand_dislikes: [],
      },
    } as unknown as SkinProfile;

    await expect(
      generator.assessStarterTreatment({
        ...unsafeContext,
        mode: 'starter',
        activeProducts: [],
        allProducts: [],
      }),
    ).resolves.toBeNull();
  });

  it('normalizes contradictory retailer availability instead of trusting the model label', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'broad-spectrum-sunscreen-spf-30',
            brand: 'Good Brand',
            productName: 'No Retailer SPF',
            budgetTier: 'mid',
            priceCents: 2200,
            currency: 'usd',
            availabilityStatus: 'local',
            recommendationRankReason: 'Claims local availability.',
            localAlternativeReason: null,
            retailers: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [
              {
                brand: 'Alt Brand',
                productName: 'Unavailable But Linked',
                budgetTier: 'mid',
                priceCents: 1800,
                currency: 'usd',
                availabilityStatus: 'unavailable',
                recommendationRankReason: 'Contradictory retailer state.',
                localAlternativeReason: null,
                retailers: [
                  {
                    name: 'Shop',
                    url: 'https://example.com/linked-alt',
                    priceCents: 1800,
                    currency: 'usd',
                    inStock: true,
                    isAffiliate: false,
                  },
                ],
                reasoningChips: [],
                reasoningFacts: {},
                ruledOut: [],
                sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
              },
            ],
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const picks = await generator.generate(context(), [
      gap(
        'Broad-spectrum sunscreen SPF 30+',
        'broad-spectrum-sunscreen-spf-30',
      ),
    ]);

    expect(
      picks.get('broad-spectrum-sunscreen-spf-30')?.availabilityStatus,
    ).toBe('unknown');
    expect(
      picks.get('broad-spectrum-sunscreen-spf-30')?.alternatives[0]
        ?.availabilityStatus,
    ).toBe('unknown');
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

function context(
  overrides: Partial<SmartPicksContext> = {},
): SmartPicksContext {
  const base: SmartPicksContext = {
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
  return { ...base, ...overrides };
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
