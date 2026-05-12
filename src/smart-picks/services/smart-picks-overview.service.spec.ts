import { Repository } from 'typeorm';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { SuggestionGapAction } from '../../suggestions/entities/suggestion-gap-action.entity';
import { SuggestionObservabilityService } from '../../suggestions/services/suggestion-observability.service';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { User } from '../../users/entities/user.entity';
import { SmartPickProductSuggestion } from '../entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../entities/smart-pick-snapshot.entity';
import {
  SmartPicksCoverage,
  SmartPicksEmptyReason,
  SmartPicksGapKind,
  SmartPicksProductAdherence,
  SmartPicksProductPerformanceSignal,
} from '../smart-picks.types';
import { GeneratedSmartPick } from './smart-picks-ai-generator';
import { SmartPicksContext } from './smart-picks-context-builder';
import {
  buildGapSnapshots,
  SmartPicksOverviewService,
  toProductPick,
} from './smart-picks-overview.service';

describe('SmartPicksOverviewService', () => {
  it('marks retailer data as stale after the freshness window expires', () => {
    const pick = toProductPick(
      productSuggestion({
        retailer_data_checked_at: new Date('2026-05-01T08:00:00.000Z'),
        retailer_data_expires_at: new Date('2026-05-02T08:00:00.000Z'),
      }),
    );

    expect(pick.retailerDataCheckedAt).toBe('2026-05-01T08:00:00.000Z');
    expect(pick.retailerDataStale).toBe(true);
  });

  it('records Smart Picks generation metrics without product or retailer identifiers', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const contextBuilder = {
      build: jest.fn().mockResolvedValue(context()),
    };
    const coverageService = {
      compute: jest.fn().mockReturnValue(coverage()),
    };
    const aiGenerator = {
      generate: jest
        .fn()
        .mockResolvedValue(
          new Map<string, GeneratedSmartPick>([
            ['broad-spectrum-sunscreen-spf-30', generatedPick()],
          ]),
        ),
    };
    const observability = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SuggestionObservabilityService>;

    repos.snapshots.findOne.mockResolvedValue(null);
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(
      async (value) =>
        ({
          id: 'snapshot-1',
          generated_at: new Date('2026-05-12T09:00:00.000Z'),
          expires_at: new Date('2026-05-13T09:00:00.000Z'),
          user: undefined as never,
          generateId: jest.fn(),
          ...value,
        }) as SmartPickSnapshot,
    );
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.suggestions.save.mockResolvedValue(productSuggestion());
    repos.actions.find.mockResolvedValue([]);

    const service = new SmartPicksOverviewService(
      contextBuilder as never,
      coverageService,
      { detect: jest.fn().mockReturnValue([]) },
      aiGenerator as never,
      { dispatch: jest.fn().mockResolvedValue(null) } as never,
      observability,
      repos.snapshots,
      repos.suggestions,
      repos.actions,
      repos.profiles,
    );

    await service.getOverview(user());

    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'smart_pick_generation_degraded',
        severity: 'warning',
        userId: 'user-1',
        metadata: expect.objectContaining({
          requestedGapCount: 5,
          generatedPickCount: 1,
          importOnlyPickCount: 1,
          localAlternativeCount: 1,
          mode: 'refine',
        }),
      }),
    );
    const metadata = observability.record.mock.calls[0]?.[0].metadata ?? {};
    expect(JSON.stringify(metadata)).not.toContain('Good Brand');
    expect(JSON.stringify(metadata)).not.toContain('https://example.com');
  });

  it('adds a clear replacement gap when product history shows consistent use without progress', () => {
    const gaps = buildGapSnapshots(replacementContext(), filledCoverage());

    expect(gaps[0]).toEqual(
      expect.objectContaining({
        gapKind: SmartPicksGapKind.Replacement,
        priority: 'priority',
        ingredientOrCategory: 'Replacement for Current Brightening Serum',
        replacementFor: expect.objectContaining({
          productId: 'owned-1',
          productName: 'Current Brightening Serum',
          usageDaysLast90: 42,
          photoCheckpoints: 3,
        }),
      }),
    );
    expect(gaps[0].reason).toContain('42 logged use days');
    expect(gaps[0].reason).toContain('photo history still shows');
  });

  it('does not call the shelf complete when every current gap is paused by dismissal', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = context();
    const currentGap = buildGapSnapshots(activeContext, coverage())[0];
    if (!currentGap) throw new Error('Expected a Smart Picks gap fixture.');

    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        gaps_json: [currentGap],
        coverage_json: coverage(),
        covered_json: [],
        redundancy_json: [],
      }),
    );
    repos.suggestions.find.mockResolvedValue([productSuggestion()]);
    repos.actions.find.mockResolvedValue([
      gapAction({
        normalized_key: currentGap.normalizedKey,
        action: 'dismissed',
        updated_at: new Date('2099-05-01T09:00:00.000Z'),
      }),
    ]);

    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      repos,
    });

    const overview = await service.getOverview(user());

    expect(overview.priorityGaps).toHaveLength(0);
    expect(overview.emptyState).toEqual(
      expect.objectContaining({
        reason: SmartPicksEmptyReason.AllGapsDismissed,
        dismissedGapCount: 1,
        nextEligibleAt: '2099-05-31T09:00:00.000Z',
      }),
    );
  });

  it('keeps redundancy visible when there are no purchase gaps', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = {
      ...context(),
      activeProducts: [ownedProduct()],
      productPerformance: [],
    };
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        gaps_json: [],
        coverage_json: filledCoverage(),
        covered_json: [],
        redundancy_json: [
          {
            activeTag: 'salicylic_acid',
            hint: 'You have more than one salicylic acid product.',
            products: [
              {
                id: 'owned-1',
                brand: 'Owned',
                name: 'Cleanser',
                recommendation: 'keep',
              },
            ],
          },
        ],
      }),
    );
    repos.suggestions.find.mockResolvedValue([]);
    repos.actions.find.mockResolvedValue([]);

    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      repos,
    });

    const overview = await service.getOverview(user());

    expect(overview.priorityGaps).toHaveLength(0);
    expect(overview.redundancy).toHaveLength(1);
    expect(overview.emptyState.reason).toBe(
      SmartPicksEmptyReason.RedundancyOnly,
    );
  });
});

function serviceWith({
  contextBuilder,
  repos,
}: {
  contextBuilder: Pick<SmartPicksOverviewService, never> & {
    build: jest.Mock;
  };
  repos: {
    snapshots: jest.Mocked<Repository<SmartPickSnapshot>>;
    suggestions: jest.Mocked<Repository<SmartPickProductSuggestion>>;
    actions: jest.Mocked<Repository<SuggestionGapAction>>;
    profiles: jest.Mocked<Repository<SkinProfile>>;
  };
}) {
  return new SmartPicksOverviewService(
    contextBuilder as never,
    { compute: jest.fn().mockReturnValue(coverage()) },
    { detect: jest.fn().mockReturnValue([]) },
    { generate: jest.fn().mockResolvedValue(new Map()) } as never,
    { dispatch: jest.fn().mockResolvedValue(null) } as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    repos.snapshots,
    repos.suggestions,
    repos.actions,
    repos.profiles,
  );
}

function repo<T extends object>() {
  return {
    create: jest.fn((value) => value),
    delete: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function user(): User {
  return { id: 'user-1', time_zone: 'Europe/Stockholm' } as User;
}

function context(
  overrides: Partial<SmartPicksContext> = {},
): SmartPicksContext {
  return {
    user: user(),
    skinProfile: {
      user_id: 'user-1',
      skin_type: 'combination',
      skin_tone: 'deep',
      ethnicity: 'Yoruba',
      current_concerns: ['dark marks'],
      primary_goal: 'dark marks',
      country_code: 'SE',
      city: 'Stockholm',
      allow_smart_picks: true,
    } as unknown as SkinProfile,
    skinProfileRequired: false,
    consentRequired: false,
    activeProducts: [],
    allProducts: [ownedProduct()],
    environment: null,
    budgetTier: 'mid',
    mode: 'refine',
    inputsHash: 'hash-1',
    productPerformance: [],
    missingProfileFields: [],
    ...overrides,
  };
}

function replacementContext(): SmartPicksContext {
  return {
    ...context(),
    activeProducts: [ownedProduct()],
    productPerformance: [
      {
        productId: 'owned-1',
        brand: 'Owned',
        productName: 'Current Brightening Serum',
        category: ProductCategory.Serum,
        usageDaysLast30: 16,
        usageDaysLast90: 42,
        firstUsedAt: '2026-02-20',
        lastUsedAt: '2026-05-10',
        adherence: SmartPicksProductAdherence.Consistent,
        goalTrend: SmartPicksProductPerformanceSignal.NotImproving,
        concernTrend: 'hyperpigmentation',
        photoCheckpoints: 3,
        reactionSignalCount: 0,
        replacementCandidate: true,
        replacementReason:
          '42 logged use days and photo history still shows hyperpigmentation.',
      },
    ],
  };
}

function coverage(): SmartPicksCoverage {
  return {
    filled: 0,
    total: 4,
    slots: [
      slot('spf'),
      slot('moisturise'),
      slot('cleanse'),
      slot('treat'),
      {
        role: 'hydrate',
        state: 'missing',
        filledByProductId: null,
        filledByName: null,
        goalRelevance: 'supportive',
      },
    ],
  };
}

function filledCoverage(): SmartPicksCoverage {
  return {
    filled: 5,
    total: 5,
    slots: [
      {
        role: 'spf',
        state: 'filled',
        filledByProductId: 'spf-1',
        filledByName: 'SPF',
        goalRelevance: 'essential',
      },
      {
        role: 'moisturise',
        state: 'filled',
        filledByProductId: 'cream-1',
        filledByName: 'Cream',
        goalRelevance: 'essential',
      },
      {
        role: 'cleanse',
        state: 'filled',
        filledByProductId: 'cleanser-1',
        filledByName: 'Cleanser',
        goalRelevance: 'essential',
      },
      {
        role: 'treat',
        state: 'filled',
        filledByProductId: 'owned-1',
        filledByName: 'Current Brightening Serum',
        goalRelevance: 'essential',
      },
      {
        role: 'hydrate',
        state: 'filled',
        filledByProductId: 'essence-1',
        filledByName: 'Essence',
        goalRelevance: 'supportive',
      },
    ],
  };
}

function slot(role: 'spf' | 'moisturise' | 'cleanse' | 'treat') {
  return {
    role,
    state: 'missing-priority' as const,
    filledByProductId: null,
    filledByName: null,
    goalRelevance: 'essential' as const,
  };
}

function generatedPick(): GeneratedSmartPick {
  return {
    brand: 'Good Brand',
    productName: 'Mineral SPF 50',
    budgetTier: 'mid',
    priceCents: 2200,
    currency: 'USD',
    retailers: [
      {
        name: 'Derm Store',
        url: 'https://example.com/spf',
        priceCents: 2200,
        currency: 'USD',
        inStock: true,
        isAffiliate: false,
      },
    ],
    reasoningChips: [],
    reasoningFacts: {},
    ruledOut: [],
    sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    alternatives: [
      {
        brand: 'Local Brand',
        productName: 'Local SPF',
        budgetTier: 'mid',
        priceCents: 1800,
        currency: 'USD',
        retailers: [],
        reasoningChips: [],
        reasoningFacts: {},
        ruledOut: [],
        sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
        alternatives: [],
        verificationStatus: 'ai_named',
        availabilityStatus: 'local',
        recommendationRankReason: 'Available nearby.',
        localAlternativeReason: null,
      },
    ],
    verificationStatus: 'ai_named',
    availabilityStatus: 'import_only',
    recommendationRankReason: 'Best match for the goal.',
    localAlternativeReason: 'Local fallback may not match as closely.',
  };
}

function productSuggestion(
  overrides: Partial<SmartPickProductSuggestion> = {},
): SmartPickProductSuggestion {
  return {
    id: 'pick-1',
    user_id: 'user-1',
    ingredient_or_category: 'Broad-spectrum sunscreen SPF 30+',
    normalized_key: 'broad-spectrum-sunscreen-spf-30',
    brand: 'Good Brand',
    product_name: 'Mineral SPF 50',
    budget_tier: 'mid',
    price_cents: 2200,
    currency: 'USD',
    retailers_json: [],
    reasoning_chips_json: [],
    reasoning_facts_json: {},
    ruled_out_json: [],
    alternatives_json: [],
    source_ids: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    verification_status: 'ai_named',
    availability_status: 'local',
    recommendation_rank_reason: 'Best local SPF fit.',
    local_alternative_reason: null,
    retailer_data_checked_at: new Date('2099-05-12T09:00:00.000Z'),
    retailer_data_expires_at: new Date('2099-05-19T09:00:00.000Z'),
    inputs_hash: 'hash-1',
    gap_reason: 'No SPF on shelf.',
    goal_alignment: 'sun protection',
    created_at: new Date('2026-05-12T09:00:00.000Z'),
    updated_at: new Date('2026-05-12T09:00:00.000Z'),
    user: null as never,
    generateId: jest.fn(),
    ...overrides,
  };
}

function snapshot(overrides: Partial<SmartPickSnapshot>): SmartPickSnapshot {
  return {
    id: 'snapshot-1',
    user_id: 'user-1',
    mode: 'refine',
    coverage_json: coverage(),
    gaps_json: [],
    covered_json: [],
    redundancy_json: [],
    recap_json: {
      primaryGoal: 'dark marks',
      skinType: 'combination',
      location: { city: 'Stockholm', countryCode: 'SE' },
      budgetTier: 'mid',
      ethnicity: 'Yoruba',
    },
    inputs_hash: 'hash-1',
    generated_at: new Date('2026-05-12T09:00:00.000Z'),
    expires_at: new Date('2099-05-12T09:00:00.000Z'),
    created_at: new Date('2026-05-12T09:00:00.000Z'),
    updated_at: new Date('2026-05-12T09:00:00.000Z'),
    user: null as never,
    generateId: jest.fn(),
    ...overrides,
  } as SmartPickSnapshot;
}

function gapAction(
  overrides: Partial<SuggestionGapAction> = {},
): SuggestionGapAction {
  return {
    id: 'action-1',
    user_id: 'user-1',
    source_type: 'smart_pick',
    suggestion_instance_id: null,
    smart_pick_product_suggestion_id: 'pick-1',
    ingredient_or_category: 'Broad-spectrum sunscreen SPF 30+',
    normalized_key: 'broad-spectrum-sunscreen-spf-30',
    action: 'saved',
    created_at: new Date('2026-05-12T09:00:00.000Z'),
    updated_at: new Date('2026-05-12T09:00:00.000Z'),
    user: null as never,
    suggestion_instance: null,
    smart_pick_product_suggestion: null,
    generateId: jest.fn(),
    ...overrides,
  };
}

function ownedProduct(): InventoryProduct {
  return {
    id: 'owned-1',
    user_id: 'user-1',
    brand: 'Owned',
    name: 'Cleanser',
    category: ProductCategory.Cleanser,
    status: ShelfStatus.Active,
    identity: { inciIngredients: [] },
  } as unknown as InventoryProduct;
}
