import type { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import type { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import {
  SmartPicksCoverage,
  SmartPicksGapKind,
  SmartPicksProductAdherence,
  SmartPicksProductPerformanceSignal,
} from '../smart-picks.types';
import type { SmartPicksContext } from './smart-picks-context-builder';
import { buildGoalGapCandidates } from './smart-picks-goal-gap-policy';

describe('buildGoalGapCandidates', () => {
  it('builds specific recommendation lanes across every known goal family', () => {
    const personas = [
      {
        goal: 'fade dark marks and uneven tone',
        concerns: ['hyperpigmentation'],
        expected: [
          'PIH-focused serum with azelaic acid or tranexamic acid',
          'Vitamin C antioxidant serum',
          'Gentle pigment-supporting mask or peel',
          'Beginner retinoid night treatment',
        ],
      },
      {
        goal: 'calm active breakouts and clogged pores',
        concerns: ['blemishes'],
        expected: [
          'Adapalene or benzoyl peroxide acne treatment',
          'Azelaic acid acne-and-mark support serum',
          'Leave-on salicylic acid or BHA for clogged pores',
          'Barrier-support moisturizer or serum for acne routines',
          'Clay or sulfur mask for congested weeks',
        ],
      },
      {
        goal: 'smooth rough texture and bumps',
        concerns: ['rough texture'],
        expected: [
          'Gentle AHA, PHA, or BHA texture treatment',
          'Smoothing retinoid night treatment',
          'Barrier-support moisturizer or serum for texture routines',
          'Occasional smoothing mask or peel',
        ],
      },
      {
        goal: 'calm redness and repair my barrier',
        concerns: ['sensitivity'],
        expected: [
          'Barrier-calming serum with niacinamide, panthenol, or centella',
          'Recovery mask or barrier balm',
          'Mineral sunscreen for sensitive skin',
        ],
      },
      {
        goal: 'keep my skin hydrated and plump',
        concerns: ['dehydration'],
        expected: [
          'Hydrating serum with glycerin or hyaluronic acid',
          'Barrier-support moisturizer for hydration routines',
          'Overnight hydration mask',
        ],
      },
      {
        goal: 'soften fine lines and keep skin firm',
        concerns: ['fine lines'],
        expected: [
          'Beginner retinoid or retinal night treatment',
          'Peptide support serum',
          'Antioxidant serum for firmness routines',
          'Barrier-support moisturizer for retinoid nights',
        ],
      },
    ];

    for (const persona of personas) {
      const candidates = buildGoalGapCandidates(
        context({
          budgetTier: 'premium',
          skinProfile: profile({
            budget_tier: 'premium',
            primary_goal: persona.goal,
            current_concerns: persona.concerns,
          }),
        }),
        coverage(),
      );

      expect(
        candidates.map((candidate) => candidate.ingredientOrCategory),
      ).toEqual(expect.arrayContaining(persona.expected));
    }
  });

  it('keeps adjacent lanes visible when only one lane is already owned', () => {
    const scenarios = [
      {
        goal: 'fade dark marks',
        owned: product('vitamin-c-1', ProductCategory.Serum, 'Vitamin C', [
          'ascorbic acid',
        ]),
        expected: 'PIH-focused serum with azelaic acid or tranexamic acid',
        blocked: 'Vitamin C antioxidant serum',
      },
      {
        goal: 'smooth rough texture',
        owned: product('retinoid-1', ProductCategory.Serum, 'Retinal Serum', [
          'retinal',
        ]),
        expected: 'Gentle AHA, PHA, or BHA texture treatment',
        blocked: 'Smoothing retinoid night treatment',
      },
      {
        goal: 'keep my skin hydrated',
        owned: product(
          'cream-1',
          ProductCategory.Moisturizer,
          'Barrier Cream',
          ['ceramide'],
        ),
        expected: 'Hydrating serum with glycerin or hyaluronic acid',
        blocked: 'Barrier-support moisturizer for hydration routines',
      },
      {
        goal: 'soften fine lines',
        owned: product('peptide-1', ProductCategory.Serum, 'Peptide Serum', [
          'peptide',
        ]),
        expected: 'Beginner retinoid or retinal night treatment',
        blocked: 'Peptide support serum',
      },
    ];

    for (const scenario of scenarios) {
      const candidates = buildGoalGapCandidates(
        context({
          budgetTier: 'premium',
          activeProducts: [scenario.owned],
          skinProfile: profile({
            budget_tier: 'premium',
            primary_goal: scenario.goal,
            current_concerns: [scenario.goal],
          }),
        }),
        coverage(),
      );
      const names = candidates.map(
        (candidate) => candidate.ingredientOrCategory,
      );

      expect(names).toContain(scenario.expected);
      expect(names).not.toContain(scenario.blocked);
    }
  });

  it('expands active acne into specific treatment lanes instead of one generic bucket', () => {
    const candidates = buildGoalGapCandidates(
      context({
        budgetTier: 'premium',
        skinProfile: profile({
          budget_tier: 'premium',
          primary_goal: 'calm active acne and breakouts',
          current_concerns: ['acne', 'clogged pores', 'post-acne marks'],
        }),
      }),
      coverage(),
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'priority',
          ingredientOrCategory: 'Adapalene or benzoyl peroxide acne treatment',
        }),
        expect.objectContaining({
          priority: 'consider',
          ingredientOrCategory: 'Azelaic acid acne-and-mark support serum',
        }),
        expect.objectContaining({
          priority: 'consider',
          ingredientOrCategory:
            'Leave-on salicylic acid or BHA for clogged pores',
        }),
        expect.objectContaining({
          priority: 'consider',
          ingredientOrCategory:
            'Barrier-support moisturizer or serum for acne routines',
        }),
        expect.objectContaining({
          priority: 'consider',
          ingredientOrCategory: 'Clay or sulfur mask for congested weeks',
        }),
      ]),
    );
    expect(
      candidates.map((candidate) => candidate.ingredientOrCategory),
    ).not.toContain(
      'Low-irritation acne treatment with azelaic acid, BHA, or benzoyl peroxide',
    );
  });

  it('does not let one salicylic acid product hide missing benzoyl peroxide or adapalene support', () => {
    const candidates = buildGoalGapCandidates(
      context({
        budgetTier: 'mid',
        activeProducts: [
          product('bha-1', ProductCategory.Serum, 'BHA Clearing Serum', [
            'salicylic acid',
          ]),
        ],
        skinProfile: profile({
          budget_tier: 'mid',
          primary_goal: 'calm breakouts',
          current_concerns: ['acne'],
        }),
      }),
      coverage(),
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'priority',
          ingredientOrCategory: 'Adapalene or benzoyl peroxide acne treatment',
        }),
      ]),
    );
    expect(
      candidates.map((candidate) => candidate.ingredientOrCategory),
    ).not.toContain('Leave-on salicylic acid or BHA for clogged pores');
  });

  it('avoids retinoid-led acne gaps when pregnancy caution is active', () => {
    const candidates = buildGoalGapCandidates(
      context({
        budgetTier: 'premium',
        skinProfile: profile({
          budget_tier: 'premium',
          primary_goal: 'calm breakouts',
          current_concerns: ['acne'],
          pregnancy_status: 'pregnant',
        }),
      }),
      coverage(),
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'priority',
          ingredientOrCategory:
            'Benzoyl peroxide or azelaic acid acne treatment',
        }),
      ]),
    );
    expect(
      candidates.map((candidate) => candidate.ingredientOrCategory).join(' '),
    ).not.toMatch(/adapalene|retinoid/i);
  });

  it('does not create generic filler when a known goal policy is already covered', () => {
    const candidates = buildGoalGapCandidates(
      context({
        budgetTier: 'premium',
        activeProducts: [
          product('combo-1', ProductCategory.Serum, 'Adapalene BPO Gel', [
            'adapalene',
            'benzoyl peroxide',
          ]),
          product('azelaic-1', ProductCategory.Serum, 'Azelaic Serum', [
            'azelaic acid',
          ]),
          product('barrier-1', ProductCategory.Moisturizer, 'Barrier Cream', [
            'ceramide',
            'panthenol',
          ]),
          product('mask-1', ProductCategory.Mask, 'Sulfur Clay Mask', [
            'sulfur',
            'kaolin',
          ]),
          product('bha-1', ProductCategory.Serum, 'BHA Serum', [
            'salicylic acid',
          ]),
          product('vitamin-c-1', ProductCategory.Serum, 'Vitamin C Serum', [
            'ascorbic acid',
          ]),
        ],
        skinProfile: profile({
          budget_tier: 'premium',
          primary_goal: 'calm breakouts',
          current_concerns: ['acne', 'clogged pores', 'post-acne marks'],
        }),
      }),
      coverage(),
    );

    expect(candidates).toEqual([]);
  });

  it('does not treat post-acne marks as active acne without breakout signals', () => {
    const candidates = buildGoalGapCandidates(
      context({
        budgetTier: 'premium',
        activeProducts: [
          product('azelaic-serum', ProductCategory.Serum, 'Azelaic Serum', [
            'azelaic acid',
          ]),
        ],
        skinProfile: profile({
          budget_tier: 'premium',
          primary_goal: 'remove dark spots',
          current_concerns: ['post-acne marks'],
        }),
      }),
      coverage(),
    );

    expect(
      candidates.map((candidate) => candidate.ingredientOrCategory),
    ).toEqual(
      expect.arrayContaining([
        'Vitamin C antioxidant serum',
        'Gentle pigment-supporting mask or peel',
        'Beginner retinoid night treatment',
      ]),
    );
    expect(
      candidates.map((candidate) => candidate.ingredientOrCategory),
    ).toEqual(
      expect.not.arrayContaining([
        'Low-irritation acne treatment with azelaic acid, BHA, or benzoyl peroxide',
        'Barrier-support serum for acne routines',
        'Clay or sulfur mask for congested weeks',
      ]),
    );
  });

  it('avoids retinoid-led aging gaps when pregnancy caution is active', () => {
    const candidates = buildGoalGapCandidates(
      context({
        budgetTier: 'mid',
        skinProfile: profile({
          budget_tier: 'mid',
          primary_goal: 'soften fine lines',
          current_concerns: ['fine lines'],
          pregnancy_status: 'pregnant',
        }),
      }),
      coverage(),
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gapKind: SmartPicksGapKind.GoalSupport,
          priority: 'consider',
          ingredientOrCategory: 'Antioxidant serum for firmness routines',
          goalAlignment: 'early aging support',
        }),
      ]),
    );
    expect(
      candidates.map((candidate) => candidate.ingredientOrCategory),
    ).not.toContain('Beginner retinoid or retinal night treatment');
    expect(
      candidates.map((candidate) => candidate.ingredientOrCategory),
    ).not.toContain('Goal-focused product for soften fine lines');
  });

  it('keeps optional supports budget-aware across real personas', () => {
    const personas = [
      {
        goal: 'calm redness and repair my barrier',
        budgetTier: 'drugstore',
        expected: [
          'Barrier-calming serum with niacinamide, panthenol, or centella',
        ],
        blocked: ['Recovery mask or barrier balm'],
      },
      {
        goal: 'keep my skin hydrated and plump',
        budgetTier: 'luxury',
        expected: [
          'Hydrating serum with glycerin or hyaluronic acid',
          'Overnight hydration mask',
        ],
        blocked: [],
      },
      {
        goal: 'smooth rough texture',
        budgetTier: 'premium',
        expected: [
          'Gentle AHA, PHA, or BHA texture treatment',
          'Smoothing retinoid night treatment',
        ],
        blocked: [],
      },
    ] as const;

    for (const persona of personas) {
      const candidates = buildGoalGapCandidates(
        context({
          budgetTier: persona.budgetTier,
          skinProfile: profile({
            budget_tier: persona.budgetTier,
            primary_goal: persona.goal,
            current_concerns: [persona.goal],
          }),
        }),
        coverage(),
      );
      const names = candidates.map(
        (candidate) => candidate.ingredientOrCategory,
      );

      expect(names).toEqual(expect.arrayContaining([...persona.expected]));
      if (persona.blocked.length > 0) {
        expect(names).toEqual(expect.not.arrayContaining([...persona.blocked]));
      }
    }
  });
});

function context(
  overrides: Partial<SmartPicksContext> = {},
): SmartPicksContext {
  return {
    user: {
      id: 'user-1',
      time_zone: 'Europe/Stockholm',
    } as SmartPicksContext['user'],
    skinProfile: profile(),
    skinProfileRequired: false,
    consentRequired: false,
    activeProducts: [],
    allProducts: [],
    environment: null,
    budgetTier: 'mid',
    mode: 'refine',
    inputsHash: 'hash-1',
    productPerformance: [
      {
        productId: 'owned-1',
        brand: 'Owned',
        productName: 'Owned Serum',
        category: ProductCategory.Serum,
        usageDaysLast30: 0,
        usageDaysLast90: 0,
        firstUsedAt: null,
        lastUsedAt: null,
        adherence: SmartPicksProductAdherence.None,
        goalTrend: SmartPicksProductPerformanceSignal.InsufficientHistory,
        concernTrend: null,
        photoCheckpoints: 0,
        reactionSignalCount: 0,
        replacementCandidate: false,
        replacementReason: null,
      },
    ],
    missingProfileFields: [],
    ...overrides,
  };
}

function profile(overrides: Partial<SkinProfile> = {}): SkinProfile {
  return {
    user_id: 'user-1',
    skin_type: 'combination',
    skin_tone: 'deep',
    ethnicity: 'Yoruba',
    current_concerns: ['dark marks'],
    primary_goal: 'dark marks',
    country_code: 'SE',
    city: 'Stockholm',
    allow_smart_picks: true,
    pregnancy_status: 'not_pregnant',
    ...overrides,
  } as unknown as SkinProfile;
}

function coverage(): SmartPicksCoverage {
  return {
    filled: 0,
    total: 1,
    slots: [
      {
        role: 'goal-primary',
        state: 'missing-priority',
        filledByProductId: null,
        filledByName: null,
        goalRelevance: 'essential',
      },
    ],
  };
}

function product(
  id: string,
  category: ProductCategory,
  name: string,
  inciIngredients: readonly string[] = [],
): InventoryProduct {
  return {
    id,
    user_id: 'user-1',
    brand: 'Test Brand',
    name,
    category,
    status: ShelfStatus.Active,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    identity: { inciIngredients: [...inciIngredients] },
  } as unknown as InventoryProduct;
}
