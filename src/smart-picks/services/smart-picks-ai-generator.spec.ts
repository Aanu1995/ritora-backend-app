import { ConfigService } from '@nestjs/config';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import type { PlatformGlobalRestrictionsService } from '../../platform-controls/platform-global-restrictions.service';
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
import {
  GoldenSmartPicksPersona,
  GoldenSmartPicksProduct,
  SMART_PICKS_GOLDEN_PERSONAS,
} from '../evaluation/smart-picks-golden-personas';

describe('SmartPicksAiGenerator', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('skips OpenAI calls while global AI generation is disabled', async () => {
    global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    const platformRestrictions = {
      isCapabilityDisabled: jest.fn().mockResolvedValue(true),
    } as unknown as PlatformGlobalRestrictionsService;
    const generator = new SmartPicksAiGenerator(
      configService(),
      platformRestrictions,
    );

    const result = await generator.generateWithDiagnostics(context(), gaps());
    const plan = await generator.generatePlanWithDiagnostics(context());
    const starterTreatment = await generator.assessStarterTreatment(context());

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.diagnostics.providerSkippedReason).toBe(
      SmartPicksAiProviderSkippedReason.PlatformGlobalRestriction,
    );
    expect(plan.diagnostics.providerSkippedReason).toBe(
      SmartPicksAiProviderSkippedReason.PlatformGlobalRestriction,
    );
    expect(starterTreatment).toBeNull();
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
      expect.objectContaining({ max_output_tokens: 6000, temperature: 0 }),
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
      'When the user has a budget tier, return a budgetTier for every main pick and alternative',
    );
    expect(userPrompt).toContain(
      'Do not use the same exact brand and product name for more than one gap',
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

  it('uses AI to produce coverage and gap decisions, then validates them before snapshotting', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'spf',
              state: 'filled',
              filledByProductId: 'owned-spf',
              goalRelevance: 'essential',
            },
            {
              role: 'acne-treatment',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'not-a-real-role',
              state: 'missing',
              filledByProductId: null,
              goalRelevance: 'optional',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory:
              'Adapalene or benzoyl peroxide acne treatment',
            priority: 'priority',
            reason:
              'The profile and shelf suggest a leave-on breakout lane is missing.',
            shortReason: 'Leave-on breakout lane is missing.',
            goalAlignment: 'breakout control',
            sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Owned Cleanser',
            priority: 'priority',
            reason: 'Duplicate owned product.',
            shortReason: 'Duplicate owned product.',
            goalAlignment: 'cleanse',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.Missing,
          },
          {
            ingredientOrCategory: 'Retinol night treatment',
            priority: 'consider',
            reason: 'Blocked by active tolerance.',
            shortReason: 'Blocked by active tolerance.',
            goalAlignment: 'texture support',
            sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Replacement SPF',
            priority: 'priority',
            reason:
              'Replace the current SPF even though history has not marked it as a replacement candidate.',
            shortReason: 'Replace the current SPF.',
            goalAlignment: 'sun protection',
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
            gapKind: SmartPicksGapKind.Replacement,
            replacementForProductId: 'owned-spf',
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        activeProducts: [
          product('owned-spf', ProductCategory.SunProtection, 'Daily SPF'),
          product('owned-cleanser', ProductCategory.Cleanser, 'Owned Cleanser'),
        ],
        allProducts: [
          product('owned-spf', ProductCategory.SunProtection, 'Daily SPF'),
          product('owned-cleanser', ProductCategory.Cleanser, 'Owned Cleanser'),
        ],
        skinProfile: profile({
          active_tolerances: {
            retinol: { tolerance: 'cannot_use' },
          },
        }),
      }),
    );

    expect(plan).toEqual(
      expect.objectContaining({
        coverage: expect.objectContaining({
          filled: 1,
          total: 2,
          slots: [
            {
              role: 'spf',
              state: 'filled',
              filledByProductId: 'owned-spf',
              filledByName: 'Owned Brand Daily SPF',
              goalRelevance: 'essential',
            },
            {
              role: 'acne-treatment',
              state: 'missing-priority',
              filledByProductId: null,
              filledByName: null,
              goalRelevance: 'essential',
            },
          ],
        }),
        priorityGaps: expect.arrayContaining([
          expect.objectContaining({
            normalizedKey: 'adapalene-or-benzoyl-peroxide-acne-treatment',
            gapKind: SmartPicksGapKind.GoalSupport,
          }),
        ]),
        considerGaps: [],
      }),
    );
    const rawRequestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof rawRequestBody).toBe('string');
    const requestBody = JSON.parse(rawRequestBody as string) as {
      input?: { content?: { text?: string }[] }[];
      text?: { format?: { name?: string } };
    };
    const systemPrompt = requestBody.input?.[0]?.content?.[0]?.text ?? '';
    const userPrompt = requestBody.input?.[1]?.content?.[0]?.text ?? '';
    expect(requestBody.text?.format?.name).toBe('smart_picks_plan_response');
    expect(systemPrompt).toContain(
      'AI-first Smart Picks coverage and gap analyst',
    );
    expect(userPrompt).toContain(
      'Decide the coverage meter and purchase gaps from the full context',
    );
    expect(userPrompt).toContain('Product performance summary');
    expect(userPrompt).toContain('Photo and journal trends');
    expect(userPrompt).toContain(
      'Do not add generic hydration, eye, or nice-to-have coverage just to fill space',
    );
    expect(userPrompt).toContain(
      'Prefer specific coverage roles over goal-primary, goal-support, or treatment-secondary',
    );
    expect(userPrompt).toContain(
      'Use goal-primary and goal-support only when no specific allowed role describes the need',
    );
    expect(userPrompt).toContain(
      'When a starter user has no active products, cleanser, moisturizer, and sunscreen are priority gaps unless the profile clearly says one is unsuitable',
    );
    expect(userPrompt).toContain(
      'For premium or luxury budgets, include two worth-considering lanes when two safe, useful supports exist',
    );
    expect(userPrompt).toContain(
      'For starter mode with no active products and a real goal beyond basic maintenance, aim for four priority essentials or goal steps plus two worth-considering supports when safe',
    );
    expect(userPrompt).toContain(
      'Worth-considering lanes still need concrete product categories',
    );
    expect(userPrompt).toContain(
      'Use the goal examples as examples, not a closed list',
    );
    expect(userPrompt).toContain(
      'For pigment or uneven-tone goals, an antioxidant serum should usually be considered before more niche optional steps',
    );
  });

  it('guardrails starter AI plans so missing basics get matching priority gaps', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'cleanse',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'moisturise',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'spf',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'dark-spot-treatment',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Barrier-support moisturizer',
            priority: 'priority',
            reason: 'Moisturizer keeps the routine tolerable.',
            shortReason: 'Add moisturizer.',
            goalAlignment: 'barrier support',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.Starter,
          },
          {
            ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
            priority: 'priority',
            reason: 'Sunscreen protects visible marks.',
            shortReason: 'Add sunscreen.',
            goalAlignment: 'sun protection',
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
            gapKind: SmartPicksGapKind.Starter,
          },
          {
            ingredientOrCategory: 'Azelaic acid dark-spot treatment',
            priority: 'priority',
            reason: 'A pigment lane fits the stated goal.',
            shortReason: 'Add pigment support.',
            goalAlignment: 'dark marks',
            sourceIds: [
              SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            ],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        mode: 'starter',
        activeProducts: [],
        allProducts: [],
      }),
    );

    expect(plan?.priorityGaps.map((gap) => gap.normalizedKey)).toEqual([
      'low-stripping-gentle-cleanser',
      'barrier-support-moisturizer',
      'broad-spectrum-sunscreen-spf-30',
      'azelaic-acid-dark-spot-treatment',
    ]);
  });

  it('strengthens generic starter moisturizer gaps into barrier-support moisturizer gaps', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'cleanse',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'moisturise',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'spf',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Gentle cleanser',
            priority: 'priority',
            reason: 'A beginner routine needs a gentle cleanser.',
            shortReason: 'Add cleanser.',
            goalAlignment: 'starter routine',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.Starter,
          },
          {
            ingredientOrCategory: 'Non-comedogenic moisturizer',
            priority: 'priority',
            reason:
              'A beginner routine needs a moisturizer to support the barrier.',
            shortReason: 'Add moisturizer.',
            goalAlignment: 'starter routine',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.Starter,
          },
          {
            ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
            priority: 'priority',
            reason: 'A beginner routine needs sunscreen.',
            shortReason: 'Add sunscreen.',
            goalAlignment: 'sun protection',
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
            gapKind: SmartPicksGapKind.Starter,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        mode: 'starter',
        activeProducts: [],
        allProducts: [],
        productPerformance: [],
      }),
    );

    expect(plan?.priorityGaps.map((gap) => gap.normalizedKey)).toEqual([
      'gentle-cleanser',
      'barrier-support-moisturizer',
      'broad-spectrum-sunscreen-spf-30',
    ]);
  });

  it('strengthens generic starter sunscreen gaps for sensitive profiles', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'spf',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Broad-spectrum SPF 30 sunscreen',
            priority: 'priority',
            reason: 'A starter routine needs daily sunscreen.',
            shortReason: 'Add sunscreen.',
            goalAlignment: 'sun protection',
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
            gapKind: SmartPicksGapKind.Starter,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        mode: 'starter',
        activeProducts: [],
        allProducts: [],
        productPerformance: [],
        skinProfile: profile({
          primary_goal: 'build a simple routine for dry sensitive skin',
          current_concerns: ['dryness', 'sensitivity'],
          shopping_preferences: {
            ingredient_dislikes: ['fragrance'],
            product_dislikes: [],
            brand_dislikes: [],
          },
        }),
      }),
    );

    expect(plan?.priorityGaps.map((gap) => gap.normalizedKey)).toEqual([
      'low-stripping-gentle-cleanser',
      'barrier-support-moisturizer',
      'sensitive-skin-sunscreen',
    ]);
  });

  it('guardrails refine AI plans so history-backed replacements are not missed', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'dark-spot-treatment',
              state: 'filled',
              filledByProductId: 'owned-1',
              goalRelevance: 'essential',
            },
            {
              role: 'antioxidant',
              state: 'missing',
              filledByProductId: null,
              goalRelevance: 'supportive',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Vitamin C antioxidant serum',
            priority: 'consider',
            reason: 'Optional antioxidant support.',
            shortReason: 'Optional antioxidant.',
            goalAlignment: 'tone support',
            sourceIds: [
              SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            ],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(context());

    expect(plan?.priorityGaps).toContainEqual(
      expect.objectContaining({
        normalizedKey: 'replacement-for-owned-cleanser',
        gapKind: SmartPicksGapKind.Replacement,
        replacementFor: expect.objectContaining({
          productId: 'owned-1',
          replacementCandidate: true,
        }),
      }),
    );
  });

  it('promotes history-backed replacement gaps to priority when AI softens them', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'dark-spot-treatment',
              state: 'filled',
              filledByProductId: 'owned-1',
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory:
              'Replace brightening serum with targeted pigment serum',
            priority: 'consider',
            reason:
              'Use logs and photo checkpoints suggest progress has stayed flat.',
            shortReason: 'Consider a better-fitting replacement.',
            goalAlignment: 'replacement for slow progress',
            sourceIds: [
              SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            ],
            gapKind: SmartPicksGapKind.Replacement,
            replacementForProductId: 'owned-1',
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(context());

    expect(plan?.priorityGaps).toContainEqual(
      expect.objectContaining({
        normalizedKey: 'replace-brightening-serum-with-targeted-pigment-serum',
        priority: 'priority',
        gapKind: SmartPicksGapKind.Replacement,
        replacementFor: expect.objectContaining({ productId: 'owned-1' }),
      }),
    );
    expect(plan?.considerGaps).toEqual([]);
  });

  it('removes urgent refine gaps when AI coverage says the shelf is already covered', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'cleanse',
              state: 'filled',
              filledByProductId: 'owned-cleanser',
              goalRelevance: 'essential',
            },
            {
              role: 'moisturise',
              state: 'filled',
              filledByProductId: 'owned-moisturizer',
              goalRelevance: 'supportive',
            },
            {
              role: 'spf',
              state: 'filled',
              filledByProductId: 'owned-spf',
              goalRelevance: 'supportive',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Extra leave-on serum',
            priority: 'priority',
            reason:
              'The AI thinks this would be nice, but coverage is already filled.',
            shortReason: 'Extra serum.',
            goalAlignment: 'optional support',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Optional calming mask',
            priority: 'consider',
            reason: 'A low-risk extra could be considered later.',
            shortReason: 'Optional mask.',
            goalAlignment: 'comfort',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        activeProducts: [
          product('owned-cleanser', ProductCategory.Cleanser, 'Cleanser'),
          product(
            'owned-moisturizer',
            ProductCategory.Moisturizer,
            'Moisturizer',
          ),
          product('owned-spf', ProductCategory.SunProtection, 'SPF'),
        ],
        allProducts: [
          product('owned-cleanser', ProductCategory.Cleanser, 'Cleanser'),
          product(
            'owned-moisturizer',
            ProductCategory.Moisturizer,
            'Moisturizer',
          ),
          product('owned-spf', ProductCategory.SunProtection, 'SPF'),
        ],
        productPerformance: [],
        budgetTier: 'mid',
      }),
    );

    expect(plan?.priorityGaps).toEqual([]);
    expect(plan?.considerGaps.map((gap) => gap.normalizedKey)).toEqual([
      'optional-calming-mask',
    ]);
  });

  it('downgrades urgent refine extras to worth considering for high-spend covered shelves', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'cleanse',
              state: 'filled',
              filledByProductId: 'owned-cleanser',
              goalRelevance: 'essential',
            },
            {
              role: 'spf',
              state: 'filled',
              filledByProductId: 'owned-spf',
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Peptide support serum',
            priority: 'priority',
            reason:
              'The user may want a stronger support lane even though basics are covered.',
            shortReason: 'Optional peptide support.',
            goalAlignment: 'firmness support',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        activeProducts: [
          product('owned-cleanser', ProductCategory.Cleanser, 'Cleanser'),
          product('owned-spf', ProductCategory.SunProtection, 'SPF'),
        ],
        allProducts: [
          product('owned-cleanser', ProductCategory.Cleanser, 'Cleanser'),
          product('owned-spf', ProductCategory.SunProtection, 'SPF'),
        ],
        productPerformance: [],
        budgetTier: 'premium',
      }),
    );

    expect(plan?.priorityGaps).toEqual([]);
    expect(plan?.considerGaps).toContainEqual(
      expect.objectContaining({
        normalizedKey: 'peptide-support-serum',
        priority: 'consider',
      }),
    );
  });

  it('adds coverage slots for accepted AI gaps when the planner omits them', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'cleanse',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'spf',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Vitamin C antioxidant serum',
            priority: 'consider',
            reason: 'Antioxidant support may help the stated tone goal.',
            shortReason: 'Optional antioxidant support.',
            goalAlignment: 'tone support',
            sourceIds: [
              SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            ],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({ productPerformance: [] }),
    );

    expect(plan?.coverage.slots).toContainEqual({
      role: 'antioxidant',
      state: 'missing',
      filledByProductId: null,
      filledByName: null,
      goalRelevance: 'optional',
    });
    expect(plan?.coverage.total).toBe(3);
  });

  it('keeps moisturizer coverage visible for accepted barrier moisturizer gaps', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'barrier-support',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Barrier-support moisturizer',
            priority: 'priority',
            reason: 'A moisturizer keeps the treatment lane tolerable.',
            shortReason: 'Add moisturizer.',
            goalAlignment: 'barrier support',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        activeProducts: [],
        allProducts: [],
        productPerformance: [],
      }),
    );

    expect(plan?.coverage.slots).toContainEqual(
      expect.objectContaining({ role: 'moisturise' }),
    );
  });

  it('keeps peptide support in high-budget fine-line plans when AI picks only exfoliation as the second optional lane', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'retinoid',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'antioxidant',
              state: 'missing',
              filledByProductId: null,
              goalRelevance: 'supportive',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Beginner retinal night treatment',
            priority: 'priority',
            reason: 'A retinoid lane directly supports fine lines.',
            shortReason: 'Add one retinoid lane.',
            goalAlignment: 'fine line support',
            sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Vitamin C antioxidant serum',
            priority: 'consider',
            reason: 'Antioxidant support can complement sunscreen.',
            shortReason: 'Optional antioxidant support.',
            goalAlignment: 'tone and texture support',
            sourceIds: [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Gentle exfoliating mask',
            priority: 'consider',
            reason: 'A low-frequency exfoliating mask can support texture.',
            shortReason: 'Optional texture support.',
            goalAlignment: 'texture support',
            sourceIds: [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        activeProducts: [],
        allProducts: [],
        budgetTier: 'luxury',
        productPerformance: [],
        skinProfile: profile({
          primary_goal: 'improve early fine lines and keep texture smooth',
          current_concerns: ['fine lines', 'texture'],
          budget_tier: 'luxury',
        }),
      }),
    );

    expect(plan?.considerGaps.map((item) => item.normalizedKey)).toEqual(
      expect.arrayContaining([
        'peptide-or-barrier-support-serum',
        'vitamin-c-antioxidant-serum',
      ]),
    );
    expect(plan?.coverage.slots).toContainEqual(
      expect.objectContaining({ role: 'peptide' }),
    );
  });

  it('keeps body barrier support in body-roughness plans when AI only adds another exfoliant as optional support', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'texture-exfoliant',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Body lotion with urea or lactic acid',
            priority: 'priority',
            reason: 'A body smoothing lane fits rough bumps on arms.',
            shortReason: 'Add one body smoothing lane.',
            goalAlignment: 'body texture support',
            sourceIds: [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Gentle body exfoliant',
            priority: 'consider',
            reason: 'A second exfoliant is optional.',
            shortReason: 'Optional body exfoliant.',
            goalAlignment: 'body texture support',
            sourceIds: [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        activeProducts: [],
        allProducts: [],
        budgetTier: 'mid',
        productPerformance: [],
        skinProfile: profile({
          primary_goal: 'smooth rough bumps on arms without irritating my face',
          current_concerns: ['rough bumps', 'body texture', 'dryness'],
          shopping_preferences: {
            ingredient_dislikes: ['fragrance'],
            product_dislikes: [],
            brand_dislikes: [],
          },
        }),
      }),
    );

    expect(plan?.considerGaps.map((item) => item.normalizedKey)).toEqual(
      expect.arrayContaining(['fragrance-free-body-barrier-moisturizer']),
    );
  });

  it('adds omitted starter essential coverage from accepted AI starter gaps', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'spf',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'retinoid',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Gentle low-irritation cleanser',
            priority: 'priority',
            reason: 'A starter routine needs a cleanser.',
            shortReason: 'Add cleanser.',
            goalAlignment: 'starter routine',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.Starter,
          },
          {
            ingredientOrCategory: 'Simple moisturizer with ceramides',
            priority: 'priority',
            reason: 'A starter routine needs moisturizer.',
            shortReason: 'Add moisturizer.',
            goalAlignment: 'barrier support',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.Starter,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        mode: 'starter',
        activeProducts: [],
        allProducts: [],
        productPerformance: [],
      }),
    );

    expect(plan?.coverage.slots.map((slot) => slot.role)).toEqual(
      expect.arrayContaining(['cleanse', 'moisturise']),
    );
  });

  it('treats salicylic or BHA leave-on starter gaps as breakout treatment coverage when the wording is not a texture exfoliant', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'cleanse',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Salicylic acid BHA leave-on or wash',
            priority: 'priority',
            reason: 'This gives the starter routine one clear treatment lane.',
            shortReason: 'Add one treatment lane.',
            goalAlignment: 'oil control',
            sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        mode: 'starter',
        activeProducts: [],
        allProducts: [],
        budgetTier: 'drugstore',
        productPerformance: [],
        skinProfile: profile({
          primary_goal: 'reduce clogged pores and breakouts without stripping',
          current_concerns: ['clogged pores', 'breakouts'],
          budget_tier: 'drugstore',
        }),
      }),
    );

    expect(plan?.coverage.slots).toContainEqual(
      expect.objectContaining({ role: 'acne-treatment' }),
    );
  });

  it('keeps antioxidant support in high-budget fine-line plans when AI chooses peptide plus exfoliation', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'retinoid',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Retinoid starter serum',
            priority: 'priority',
            reason: 'A retinoid lane directly supports fine lines.',
            shortReason: 'Add retinoid support.',
            goalAlignment: 'fine lines',
            sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Peptide support serum',
            priority: 'consider',
            reason: 'Peptide support gives a recovery-night option.',
            shortReason: 'Optional peptide support.',
            goalAlignment: 'fine lines',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Gentle exfoliating mask',
            priority: 'consider',
            reason: 'Exfoliation can support texture.',
            shortReason: 'Optional texture support.',
            goalAlignment: 'texture',
            sourceIds: [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        mode: 'starter',
        activeProducts: [],
        allProducts: [],
        budgetTier: 'luxury',
        productPerformance: [],
        skinProfile: profile({
          primary_goal: 'improve early fine lines and keep texture smooth',
          current_concerns: ['fine lines', 'texture'],
          budget_tier: 'luxury',
        }),
      }),
    );

    expect(plan?.considerGaps.map((item) => item.normalizedKey)).toEqual(
      expect.arrayContaining([
        'vitamin-c-antioxidant-serum',
        'peptide-support-serum',
      ]),
    );
  });

  it('adds safe worth-considering lanes when high-budget AI plans return too few', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'cleanse',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
            {
              role: 'dark-spot-treatment',
              state: 'missing-priority',
              filledByProductId: null,
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Azelaic acid dark-spot serum',
            priority: 'priority',
            reason: 'A pigment lane fits the stated goal.',
            shortReason: 'Add pigment support.',
            goalAlignment: 'dark marks',
            sourceIds: [
              SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            ],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Vitamin C antioxidant serum',
            priority: 'consider',
            reason: 'Antioxidant support may help the tone goal.',
            shortReason: 'Optional antioxidant.',
            goalAlignment: 'tone support',
            sourceIds: [
              SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            ],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        mode: 'starter',
        activeProducts: [],
        allProducts: [],
        productPerformance: [],
        budgetTier: 'premium',
      }),
    );

    expect(plan?.considerGaps.map((gap) => gap.normalizedKey)).toEqual([
      'vitamin-c-antioxidant-serum',
      'gentle-resurfacing-mask-or-peel',
    ]);
  });

  it('adds antioxidant support when premium pigment plans skip it', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'dark-spot-treatment',
              state: 'filled',
              filledByProductId: 'owned-1',
              goalRelevance: 'essential',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory:
              'Gentle exfoliant PHA or low-strength lactic acid',
            priority: 'consider',
            reason:
              'A texture support lane may help if the routine stays calm.',
            shortReason: 'Optional texture support.',
            goalAlignment: 'texture support',
            sourceIds: [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Low-irritation retinoid',
            priority: 'consider',
            reason: 'A retinoid may support long-view texture.',
            shortReason: 'Optional retinoid.',
            goalAlignment: 'texture support',
            sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        budgetTier: 'premium',
        productPerformance: [],
        skinProfile: profile({
          primary_goal: 'keep dark marks fading while avoiding irritation',
          current_concerns: ['dark marks', 'texture'],
          budget_tier: 'premium',
        }),
      }),
    );

    expect(plan?.considerGaps.map((gap) => gap.normalizedKey)).toEqual([
      'vitamin-c-antioxidant-serum',
      'gentle-exfoliant-pha-or-low-strength-lactic-acid',
      'low-irritation-retinoid',
    ]);
  });

  it('adds a pregnancy-compatible fine-line support lane when AI only returns antioxidant support', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'retinoid',
              state: 'missing',
              filledByProductId: null,
              goalRelevance: 'optional',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Retinoid night treatment',
            priority: 'priority',
            reason: 'Retinoids are blocked by pregnancy safety context.',
            shortReason: 'Blocked retinoid.',
            goalAlignment: 'fine line support',
            sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Gentle antioxidant serum',
            priority: 'consider',
            reason: 'Antioxidant support may help while stronger actives wait.',
            shortReason: 'Optional antioxidant.',
            goalAlignment: 'fine line support',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const plan = await generator.generatePlan(
      context({
        productPerformance: [],
        budgetTier: 'mid',
        skinProfile: profile({
          primary_goal: 'support fine lines while pregnant',
          current_concerns: ['fine lines', 'dryness'],
          pregnancy_status: 'pregnant',
        }),
      }),
    );

    expect(plan?.priorityGaps).toEqual([]);
    expect(plan?.considerGaps.map((gap) => gap.normalizedKey)).toEqual([
      'peptide-or-barrier-support-serum',
      'gentle-antioxidant-serum',
    ]);
  });

  it('reports privacy-safe AI planner diagnostics for monitoring', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        coverage: {
          slots: [
            {
              role: 'spf',
              state: 'filled',
              filledByProductId: 'owned-spf',
              goalRelevance: 'essential',
            },
            {
              role: 'invalid-role',
              state: 'missing',
              filledByProductId: null,
              goalRelevance: 'optional',
            },
          ],
        },
        gaps: [
          {
            ingredientOrCategory: 'Owned Cleanser',
            priority: 'priority',
            reason: 'Owned duplicate.',
            shortReason: 'Owned duplicate.',
            goalAlignment: 'cleanse',
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
            gapKind: SmartPicksGapKind.Missing,
          },
          {
            ingredientOrCategory: 'Retinol night treatment',
            priority: 'consider',
            reason: 'Blocked by active tolerance.',
            shortReason: 'Blocked by active tolerance.',
            goalAlignment: 'texture support',
            sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
            gapKind: SmartPicksGapKind.GoalSupport,
          },
          {
            ingredientOrCategory: 'Replacement SPF',
            priority: 'priority',
            reason: 'Replace the current SPF without enough history evidence.',
            shortReason: 'Replace the current SPF.',
            goalAlignment: 'sun protection',
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
            gapKind: SmartPicksGapKind.Replacement,
            replacementForProductId: 'owned-spf',
          },
          {
            ingredientOrCategory: '',
            priority: 'priority',
            reason: '',
            shortReason: '',
            goalAlignment: null,
            sourceIds: [],
            gapKind: SmartPicksGapKind.Missing,
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const result = await generator.generatePlanWithDiagnostics(
      context({
        activeProducts: [
          product('owned-spf', ProductCategory.SunProtection, 'Daily SPF'),
          product('owned-cleanser', ProductCategory.Cleanser, 'Owned Cleanser'),
        ],
        allProducts: [
          product('owned-spf', ProductCategory.SunProtection, 'Daily SPF'),
          product('owned-cleanser', ProductCategory.Cleanser, 'Owned Cleanser'),
        ],
        skinProfile: profile({
          active_tolerances: {
            retinol: { tolerance: 'cannot_use' },
          },
        }),
      }),
    );

    expect(result.plan).toEqual(
      expect.objectContaining({
        coverage: expect.objectContaining({ filled: 1, total: 1 }),
      }),
    );
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        rawCoverageSlotCount: 2,
        acceptedCoverageSlotCount: 1,
        invalidCoverageSlotCount: 1,
        rawGapCount: 4,
        acceptedGapCount: 1,
        acceptedPriorityGapCount: 1,
        invalidGapCount: 1,
        blockedOwnedGapCount: 1,
        blockedSafetyGapCount: 1,
        blockedReplacementEvidenceGapCount: 1,
        providerFailed: false,
        missingPlan: false,
      }),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain('Owned Cleanser');
    expect(JSON.stringify(result.diagnostics)).not.toContain('Daily SPF');
  });

  it.each(SMART_PICKS_GOLDEN_PERSONAS)(
    'keeps AI planner guardrails repeatable for $id',
    async (persona) => {
      const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock;
      fetchMock.mockResolvedValue(openAiResponse(persona.aiPlanResponse));
      const generator = new SmartPicksAiGenerator(configService());

      const result = await generator.generatePlanWithDiagnostics(
        goldenPersonaContext(persona),
      );
      const plan = requirePlan(result.plan);

      expect(plan.coverage.slots.map((slot) => slot.role)).toEqual(
        expect.arrayContaining([...persona.expected.coverageRoles]),
      );
      expect(plan.priorityGaps.map((gap) => gap.normalizedKey)).toEqual([
        ...persona.expected.priorityGapKeys,
      ]);
      expect(plan.considerGaps.map((gap) => gap.normalizedKey)).toEqual(
        expect.arrayContaining([...persona.expected.considerGapKeys]),
      );
      expect(plan.considerGaps.length).toBeGreaterThanOrEqual(
        expectedMinimumConsiderGapCount(persona),
      );
      expect(result.diagnostics).toEqual(
        expect.objectContaining({
          providerFailed: false,
          missingPlan: false,
        }),
      );
      expect(result.diagnostics.blockedSafetyGapCount).toBeLessThanOrEqual(
        persona.expected.blockedSafetyGapCount,
      );
      expect(
        result.diagnostics.blockedPregnancySafetyGapCount,
      ).toBeLessThanOrEqual(persona.expected.blockedPregnancySafetyGapCount);
      expect(
        result.diagnostics.blockedReplacementEvidenceGapCount,
      ).toBeLessThanOrEqual(
        persona.expected.blockedReplacementEvidenceGapCount,
      );
      expect(JSON.stringify(result.diagnostics)).not.toContain(
        persona.activeProducts[0]?.name ?? 'unused-token',
      );
    },
  );

  it.each(
    SMART_PICKS_GOLDEN_PERSONAS.filter(
      (persona) => persona.productPickResponse !== null,
    ),
  )('accepts golden product picks for $id', async (persona) => {
    if (!persona.productPickResponse) {
      throw new Error('Expected a product-pick response fixture.');
    }
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock
      .mockResolvedValueOnce(openAiResponse(persona.aiPlanResponse))
      .mockResolvedValueOnce(openAiResponse(persona.productPickResponse));
    const generator = new SmartPicksAiGenerator(configService());
    const activeContext = goldenPersonaContext(persona);
    const plan = requirePlan(
      (await generator.generatePlanWithDiagnostics(activeContext)).plan,
    );

    const result = await generator.generateWithDiagnostics(activeContext, [
      ...plan.priorityGaps,
      ...plan.considerGaps,
    ]);

    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        acceptedPickCount: persona.expected.acceptedProductPickCount,
        providerFailed: false,
      }),
    );
    expect([...result.picks.keys()]).toEqual(
      expect.arrayContaining([
        ...persona.expected.priorityGapKeys,
        ...persona.expected.considerGapKeys,
      ]),
    );
  });

  it('keeps golden personas useful for manual review, not only unit checks', () => {
    expect(SMART_PICKS_GOLDEN_PERSONAS.length).toBeGreaterThanOrEqual(10);
    expect(
      Array.from(
        new Set(
          SMART_PICKS_GOLDEN_PERSONAS.map((persona) => persona.countryCode),
        ),
      ),
    ).toEqual(
      expect.arrayContaining(['AU', 'CA', 'DE', 'FR', 'GB', 'JP', 'SE', 'US']),
    );
    expect(
      Array.from(
        new Set(
          SMART_PICKS_GOLDEN_PERSONAS.map((persona) => persona.budgetTier),
        ),
      ),
    ).toEqual(
      expect.arrayContaining(['drugstore', 'mid', 'premium', 'luxury']),
    );
    expect(
      SMART_PICKS_GOLDEN_PERSONAS.some(
        (persona) => persona.pregnancyStatus !== null,
      ),
    ).toBe(true);
    expect(
      SMART_PICKS_GOLDEN_PERSONAS.some(
        (persona) => persona.productPerformance.length > 0,
      ),
    ).toBe(true);
    for (const persona of SMART_PICKS_GOLDEN_PERSONAS) {
      expect(persona.manualReviewChecklist.length).toBeGreaterThanOrEqual(4);
      expect(persona.currentConcerns.length).toBeGreaterThan(0);
      expect(persona.primaryGoal).not.toHaveLength(0);
      expect(persona.countryCode).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('does not create a deterministic plan when the AI planner is unavailable', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    const generator = new SmartPicksAiGenerator(configService(''));

    await expect(generator.generatePlan(context())).resolves.toBeNull();
    await expect(
      generator.generatePlanWithDiagnostics(context()),
    ).resolves.toEqual(
      expect.objectContaining({
        plan: null,
        diagnostics: expect.objectContaining({
          providerSkippedReason:
            SmartPicksAiProviderSkippedReason.MissingApiKey,
          missingPlan: true,
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits temperature for Smart Picks models that reject sampling controls', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(openAiResponse({ gaps: [] }));
    const generator = new SmartPicksAiGenerator(
      configService('test-key', 'gpt-5.5'),
    );

    await generator.generateWithDiagnostics(context(), gaps());

    const rawRequestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof rawRequestBody).toBe('string');
    const requestBody = JSON.parse(rawRequestBody as string) as Record<
      string,
      unknown
    >;
    expect(requestBody.model).toBe('gpt-5.5');
    expect(requestBody.store).toBe(false);
    expect(requestBody.temperature).toBeUndefined();
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

  it('does not block safety-friendly free-from wording for disliked ingredients', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'gentle-fragrance-free-cleanser',
            brand: 'Sensitive Brand',
            productName: 'Fragrance-Free Gentle Cleanser',
            budgetTier: 'mid',
            recommendationRankReason: 'A fragrance-free cleanser fits.',
            sellerNames: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [],
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
          },
        ],
      }),
    );
    const safeContext = context({
      skinProfile: profile({
        shopping_preferences: {
          ingredient_dislikes: ['fragrance'],
          product_dislikes: [],
          brand_dislikes: [],
        },
      }),
    });
    const generator = new SmartPicksAiGenerator(configService());

    const result = await generator.generateWithDiagnostics(safeContext, [
      gap('Gentle fragrance-free cleanser', 'gentle-fragrance-free-cleanser'),
    ]);

    expect(result.picks.get('gentle-fragrance-free-cleanser')).toEqual(
      expect.objectContaining({
        productName: 'Fragrance-Free Gentle Cleanser',
      }),
    );
    expect(result.diagnostics.blockedSafetyCount).toBe(0);
  });

  it('does not accept the same product for multiple generated gaps', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'broad-spectrum-sunscreen-spf-30',
            brand: 'Repeat Brand',
            productName: 'Repeat Serum',
            budgetTier: 'mid',
            recommendationRankReason: 'First use of the product.',
            sellerNames: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [],
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
          },
          {
            normalizedKey: 'gentle-cleanser',
            brand: 'Repeat Brand',
            productName: 'Repeat Serum',
            budgetTier: 'mid',
            recommendationRankReason: 'Duplicate product should be rejected.',
            sellerNames: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [],
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const result = await generator.generateWithDiagnostics(context(), gaps());

    expect([...result.picks.values()]).toHaveLength(1);
    expect(result.picks.has('gentle-cleanser')).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        acceptedPickCount: 1,
        invalidPickCount: 1,
        missingPickCount: 2,
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

  it('promotes a valid alternative when the main AI pick is outside the user budget', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'vitamin-c-antioxidant-serum',
            brand: 'Luxury Brand',
            productName: 'Very Expensive Vitamin C',
            budgetTier: 'luxury',
            recommendationRankReason: 'Outside budget fit.',
            sellerNames: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [
              {
                brand: 'Strong Fit',
                productName: 'Premium Vitamin C Serum',
                budgetTier: 'premium',
                recommendationRankReason:
                  'A stronger budget-safe antioxidant fit for the stated goal.',
                sellerNames: ['Reputable Seller'],
                reasoningChips: [
                  {
                    tone: 'goal',
                    text: 'Antioxidant support',
                    icon: 'sparkle',
                  },
                ],
                reasoningFacts: [
                  { label: 'Goal fit', value: 'Supports tone routine.' },
                ],
                ruledOut: [],
                sourceIds: [
                  SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
                ],
              },
            ],
            sourceIds: [
              SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            ],
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const result = await generator.generateWithDiagnostics(
      context({ budgetTier: 'premium' }),
      [gap('Vitamin C antioxidant serum', 'vitamin-c-antioxidant-serum')],
    );

    expect(result.picks.get('vitamin-c-antioxidant-serum')).toEqual(
      expect.objectContaining({
        brand: 'Strong Fit',
        productName: 'Premium Vitamin C Serum',
        budgetTier: 'premium',
      }),
    );
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        acceptedPickCount: 1,
        blockedBudgetCount: 0,
        missingPickCount: 0,
      }),
    );
  });

  it('promotes a safe alternative when the main AI pick conflicts with user safety preferences', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        gaps: [
          {
            normalizedKey: 'gentle-tone-support-serum',
            brand: 'Retinol Brand',
            productName: 'Retinol Tone Serum',
            budgetTier: 'mid',
            recommendationRankReason: 'Conflicts with preference.',
            sellerNames: [],
            reasoningChips: [],
            reasoningFacts: {},
            ruledOut: [],
            alternatives: [
              {
                brand: 'Calm Brand',
                productName: 'Azelaic Tone Serum',
                budgetTier: 'mid',
                recommendationRankReason:
                  'A safer tone-support option for this profile.',
                sellerNames: [],
                reasoningChips: [],
                reasoningFacts: {},
                ruledOut: [],
                sourceIds: [
                  SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
                ],
              },
            ],
            sourceIds: [
              SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            ],
          },
        ],
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());

    const result = await generator.generateWithDiagnostics(
      context({
        skinProfile: profile({
          shopping_preferences: {
            ingredient_dislikes: ['retinol'],
            product_dislikes: [],
            brand_dislikes: [],
          },
        }),
      }),
      [gap('Gentle tone support serum', 'gentle-tone-support-serum')],
    );

    expect(result.picks.get('gentle-tone-support-serum')).toEqual(
      expect.objectContaining({
        brand: 'Calm Brand',
        productName: 'Azelaic Tone Serum',
      }),
    );
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        acceptedPickCount: 1,
        blockedSafetyCount: 0,
        missingPickCount: 0,
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
      temperature?: number;
    };
    const systemPrompt = requestBody.input?.[0]?.content?.[0]?.text ?? '';
    const userPrompt = requestBody.input?.[1]?.content?.[0]?.text ?? '';
    expect(systemPrompt).toContain(
      'dermatologist-informed starter-kit treatment assessor',
    );
    expect(requestBody.temperature).toBe(0);
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

  it('allows retinoid starter treatment assessments when pregnancy caution is inactive', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        shouldRecommend: true,
        ingredientOrCategory: 'Beginner retinol night treatment',
        goalAlignment: 'texture support',
        reason: 'A slow-introduction retinal can support the stated goal.',
        sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
        confidence: 'medium',
      }),
    );
    const generator = new SmartPicksAiGenerator(configService());
    const safeContext = context();
    const currentProfile = safeContext.skinProfile;
    if (!currentProfile) throw new Error('Expected skin profile fixture.');
    safeContext.skinProfile = {
      ...currentProfile,
      pregnancy_status: 'not_pregnant',
    } as unknown as SkinProfile;

    const assessment = await generator.assessStarterTreatment({
      ...safeContext,
      mode: 'starter',
      activeProducts: [],
      allProducts: [],
    });

    expect(assessment?.ingredientOrCategory).toBe(
      'Beginner retinol night treatment',
    );
  });

  it('blocks retinoid starter treatment assessments when pregnancy caution is active', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      openAiResponse({
        shouldRecommend: true,
        ingredientOrCategory: 'Beginner retinol serum',
        goalAlignment: 'fine line support',
        reason: 'Retinol may support the stated goal.',
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
      pregnancy_status: 'pregnant',
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

function configService(
  apiKey: string | null = 'test-key',
  model?: string,
): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'OPENAI_API_KEY') return apiKey;
      if (key === 'SMART_PICKS_AI_MODEL') return model;
      return undefined;
    }),
  } as unknown as ConfigService;
}

function context(
  overrides: Partial<SmartPicksContext> = {},
): SmartPicksContext {
  const base: SmartPicksContext = {
    user: { id: 'user-1', time_zone: 'Europe/Stockholm' } as User,
    skinProfile: profile(),
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

function goldenPersonaContext(
  persona: GoldenSmartPicksPersona,
): SmartPicksContext {
  const activeProducts = persona.activeProducts.map(goldenProduct);
  const allProducts =
    persona.allProducts.length > 0
      ? persona.allProducts.map(goldenProduct)
      : activeProducts;
  return context({
    mode: persona.mode,
    budgetTier: persona.budgetTier,
    skinProfile: profile({
      skin_type: persona.skinType,
      skin_tone: persona.skinTone,
      ethnicity: persona.ethnicity,
      current_concerns: [...persona.currentConcerns],
      primary_goal: persona.primaryGoal,
      country_code: persona.countryCode,
      city: persona.city,
      budget_tier: persona.budgetTier,
      pregnancy_status: persona.pregnancyStatus,
      shopping_preferences: {
        ingredient_dislikes: [...persona.ingredientDislikes],
        product_dislikes: [],
        brand_dislikes: [],
      },
      reaction_history: {
        entries: persona.reactionTriggers.map((trigger) => ({ trigger })),
      },
      active_tolerances: persona.activeTolerances,
    }),
    activeProducts,
    allProducts,
    productPerformance: persona.productPerformance.map((summary) => ({
      productId: summary.productId,
      brand: summary.brand,
      productName: summary.productName,
      category: summary.category,
      usageDaysLast30: summary.usageDaysLast30,
      usageDaysLast90: summary.usageDaysLast90,
      firstUsedAt: '2026-01-15',
      lastUsedAt: '2026-05-10',
      adherence:
        summary.usageDaysLast90 > 0
          ? SmartPicksProductAdherence.Consistent
          : SmartPicksProductAdherence.None,
      goalTrend: summary.goalTrend,
      concernTrend: persona.currentConcerns[0] ?? null,
      photoCheckpoints: summary.photoCheckpoints,
      reactionSignalCount: 0,
      replacementCandidate: summary.replacementCandidate,
      replacementReason: summary.replacementReason,
    })),
  });
}

function goldenProduct(
  productFixture: GoldenSmartPicksProduct,
): InventoryProduct {
  return ownedProduct({
    id: productFixture.id,
    brand: productFixture.brand,
    name: productFixture.name,
    category: productFixture.category,
    status: productFixture.status,
    identity: {
      brand: productFixture.brand,
      name: productFixture.name,
      category: productFixture.category,
      barcode: null,
      imageUrls: [],
      sizeMl: null,
      description: null,
      inciIngredients: [...productFixture.ingredients],
      benefits: [...productFixture.benefits],
      suitedFor: [],
      inciLastConfirmedAt: null,
    },
  });
}

function requirePlan<T>(plan: T | null): T {
  if (!plan) throw new Error('Expected Smart Picks plan.');
  return plan;
}

function expectedMinimumConsiderGapCount(
  persona: (typeof SMART_PICKS_GOLDEN_PERSONAS)[number],
): number {
  return 'minimumConsiderGapCount' in persona.expected
    ? persona.expected.minimumConsiderGapCount
    : persona.expected.considerGapKeys.length;
}

function profile(overrides: Partial<SkinProfile> = {}): SkinProfile {
  return {
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
    ...overrides,
  } as unknown as SkinProfile;
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

function product(
  id: string,
  category: ProductCategory,
  name: string,
): InventoryProduct {
  return ownedProduct({ id, category, name });
}

function ownedProduct(
  overrides: Partial<InventoryProduct> = {},
): InventoryProduct {
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
    ...overrides,
  } as unknown as InventoryProduct;
}
