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
            recommendationRankReason: [
              'Because your',
              'Skin Profile',
              'uses a mid',
              'budget, best fit comes first because the finish and irritation profile suit the user goal.',
            ].join(' '),
            sellerNames: ['Derm Store', 'Derm Store', 'Stylevana'],
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
                reason: 'Outside selected budget.',
              },
            ],
            alternatives: [
              {
                brand: 'Local Brand',
                productName: 'Local SPF 50',
                budgetTier: 'mid',
                recommendationRankReason:
                  'Alternative fit, but less targeted than the top pick.',
                sellerNames: ['Local Pharmacy'],
                reasoningChips: [
                  { tone: 'location', text: 'Easy to compare', icon: 'map' },
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
            recommendationRankReason: 'Owned duplicate.',
            sellerNames: [],
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
            recommendationRankReason: 'Outside budget.',
            sellerNames: [],
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
        sellerNames: ['Derm Store', 'Stylevana'],
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
        recommendationRankReason:
          'Best fit comes first because the finish and irritation profile suit the user goal.',
        alternatives: [
          expect.objectContaining({
            brand: 'Local Brand',
            productName: 'Local SPF 50',
            sellerNames: ['Local Pharmacy'],
          }),
        ],
      }),
    );
    const rawRequestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof rawRequestBody).toBe('string');
    const requestBody = JSON.parse(rawRequestBody as string) as {
      input?: { content?: { text?: string }[] }[];
      max_output_tokens?: number;
      text?: {
        format?: {
          schema?: {
            properties?: {
              gaps?: { items?: { properties?: Record<string, unknown> } };
            };
          };
        };
      };
    };
    const systemPrompt = requestBody.input?.[0]?.content?.[0]?.text ?? '';
    const userPrompt = requestBody.input?.[1]?.content?.[0]?.text ?? '';
    expect(requestBody).toEqual(
      expect.objectContaining({ max_output_tokens: 6000 }),
    );
    const responseSchema =
      requestBody.text?.format?.schema?.properties?.gaps?.items?.properties;
    expect(responseSchema?.reasoningFacts).toEqual(
      expect.objectContaining({ type: 'array' }),
    );
    expect(systemPrompt).toContain(
      'dermatologist-informed skincare product suggestion engine',
    );
    expect(systemPrompt).toContain(
      'do not claim to diagnose, prescribe, or replace a licensed dermatologist',
    );
    expect(systemPrompt).toContain('repeated user reports');
    expect(systemPrompt).toContain(
      'Do not invent review counts, clinical claims, or guaranteed results',
    );
    expect(systemPrompt).not.toMatch(/\bYou are a dermatologist\b/i);
    expect(userPrompt).toContain('Do not return purchase URLs, prices');
    expect(userPrompt).toContain('optional reputable seller names only');
    expect(userPrompt).toContain('sellerNames as plain names only');
    expect(userPrompt).toContain(
      'Use the budget tier to choose product fit only. Do not mention budget in gap reasons, recommendationRankReason, reasoning chips, or reasoning facts.',
    );
    expect(userPrompt).not.toMatch(/selected\s+Skin\s+Profile\s+budget/i);
    expect(userPrompt).not.toMatch(/explain\s+in\s+the\s+reasoning/i);
    expect(userPrompt).toContain(
      'Return one concrete product pick for every listed gap, including priority=consider gaps',
    );
    expect(userPrompt).toContain(
      'For premium or luxury budgets, do not default to the cheapest basic option',
    );
    expect(userPrompt).toContain(
      "Choose globally by product fit first. Do not limit recommendations to the user's country.",
    );
    expect(userPrompt).toContain('Local access is secondary to product fit.');
    expect(userPrompt).toContain(
      'Use broad product reputation, repeated public user-review patterns, and well-known category performance as secondary tie-breakers only.',
    );
    expect(userPrompt).toContain(
      'Do not assume South Korean, Canadian, Australian, American, European, or any country-specific products work better as a category.',
    );
    expect(userPrompt).toContain('If the user is under dermatologist care');
    expect(userPrompt).toContain(
      'For priority gaps, explain why this product matters now.',
    );
    expect(userPrompt).toContain(
      'For worth-considering gaps, explain why it may help but is not essential.',
    );
    expect(userPrompt).toContain(
      'For goal-focused gaps, infer the most specific evidence-aligned product category',
    );
    expect(userPrompt).not.toContain('retailer');
    expect(userPrompt).not.toContain('availability');
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
    expect(userPrompt).toContain('Goal-specific pick guidance');
    expect(userPrompt).toContain(
      'dark marks or hyperpigmentation: prioritize pigment-supporting products',
    );
  });

  it('allows longer background Smart Picks AI calls before timing out', async () => {
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(openAiResponse({ gaps: [] }));
    const generator = new SmartPicksAiGenerator(configService());

    await generator.generateWithDiagnostics(context(), gaps().slice(0, 1));

    expect(timeoutSpy).toHaveBeenCalledWith(120_000);
  });

  it('accepts AI gap keys that need the same normalization as backend gaps', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'Broad spectrum sunscreen SPF 30+',
            brand: 'Good Brand',
            productName: 'Mineral SPF 50',
            budgetTier: 'mid',
            recommendationRankReason: 'Matches the protection gap.',
            sellerNames: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [],
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const result = await generator.generateWithDiagnostics(context(), [
      gap(
        'Broad-spectrum sunscreen SPF 30+',
        'broad-spectrum-sunscreen-spf-30',
      ),
    ]);

    expect(result.picks.get('broad-spectrum-sunscreen-spf-30')).toEqual(
      expect.objectContaining({
        brand: 'Good Brand',
        productName: 'Mineral SPF 50',
      }),
    );
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        acceptedPickCount: 1,
        invalidPickCount: 0,
        missingPickCount: 0,
      }),
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
            recommendationRankReason: 'Unsafe preference mismatch.',
            sellerNames: [],
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

  it('blocks AI product picks that omit budget tier when the user has a budget', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'broad-spectrum-sunscreen-spf-30',
            brand: 'Unclear Budget Brand',
            productName: 'Unclear Budget SPF',
            budgetTier: null,
            recommendationRankReason: 'No budget tier supplied.',
            sellerNames: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [],
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const result = await generator.generateWithDiagnostics(context(), [
      gap(
        'Broad-spectrum sunscreen SPF 30+',
        'broad-spectrum-sunscreen-spf-30',
      ),
    ]);

    expect(result.picks).toEqual(new Map());
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        rawGapCount: 1,
        blockedBudgetCount: 1,
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
        recommendationRankReason:
          'Best fit for PIH support and the stated routine goal.',
        sellerNames: ['Korean Seller'],
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
            recommendationRankReason: 'Alternative pigment support.',
            sellerNames: ['Local Shop'],
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
        recommendationRankReason: 'Outside budget.',
        sellerNames: [],
        reasoningChips: [],
        reasoningFacts: {},
        ruledOut: [],
        alternatives: [],
        sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
      },
      expected: {
        pickName: null,
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
    const systemPrompt = requestBody.input?.[0]?.content?.[0]?.text ?? '';
    const userPrompt = requestBody.input?.[1]?.content?.[0]?.text ?? '';
    expect(systemPrompt).toContain(
      'dermatologist-informed starter-kit treatment assessor',
    );
    expect(systemPrompt).not.toMatch(/\bYou are a dermatologist\b/i);
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

  it('deduplicates seller names and ignores legacy commerce fields', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'broad-spectrum-sunscreen-spf-30',
            brand: 'Good Brand',
            productName: 'No Link SPF',
            budgetTier: 'mid',
            recommendationRankReason: 'Best product fit.',
            sellerNames: ['Shop', 'Shop', '  Another Shop  '],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [
              {
                brand: 'Alt Brand',
                productName: 'Unavailable But Linked',
                budgetTier: 'mid',
                recommendationRankReason: 'Alternative product fit.',
                sellerNames: ['Alt Shop'],
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

    const pick = picks.get('broad-spectrum-sunscreen-spf-30');
    expect(pick?.sellerNames).toEqual(['Shop', 'Another Shop']);
    expect(pick?.alternatives[0]?.sellerNames).toEqual(['Alt Shop']);
    expect(pick?.alternatives[0]?.reasoningFacts).not.toHaveProperty(
      'availability',
    );
    expect(pick).not.toHaveProperty('priceCents');
    expect(pick).not.toHaveProperty('retailers');
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
    shortReason: 'Missing from shelf.',
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
