import {
  ApplicationMethod,
  DataProvenance,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfStatus,
} from '../../shelf/shelf.types';
import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../../application-tracking/entities/application-log-item.entity';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { AnalysisSeverity } from '../../ingredients/ingredients.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import type {
  SuggestionContextSummary,
  SuggestionIngredientConflictSummary,
} from '../suggestion-context.types';
import {
  SuggestionDaypart,
  SuggestionEvidenceSourceId,
  SuggestionRequestContextJson,
  SuggestionRequestSource,
} from '../suggestions.constants';
import {
  getSuggestionEvidenceSources,
  mergeEvidenceSourceIds,
  sourceIdsForActiveTags,
} from '../services/suggestion-evidence-sources';
import {
  TODAYS_SUGGESTION_GOLDEN_CASES,
  type TodaysSuggestionEvaluationCase,
} from './todays-suggestion-golden-cases';

export const QUICK_SUGGESTION_NO_STEP_CASE_ID = 'quick_no_extra_step_needed';
export const QUICK_SUGGESTION_PLAIN_SKIP_CASE_ID =
  'quick_plain_skip_does_not_suppress_spf';
export const QUICK_SUGGESTION_CATEGORY_OPEN_CASE_ID =
  'quick_category_open_non_serum_evening';
export const QUICK_SUGGESTION_TOLERATED_RETINOID_CASE_ID =
  'quick_tolerated_retinoid_after_exfoliating_cleanser';
export const QUICK_SUGGESTION_VITAMIN_C_NIACINAMIDE_CONFLICT_CASE_ID =
  'quick_ingredient_conflict_vitamin_c_niacinamide';
export const QUICK_SUGGESTION_RETINOID_BHA_CONFLICT_CASE_ID =
  'quick_ingredient_conflict_retinoid_bha';
export const QUICK_SUGGESTION_RETINOID_BENZOYL_CONFLICT_CASE_ID =
  'quick_ingredient_conflict_retinoid_benzoyl';
export const QUICK_SUGGESTION_VITAMIN_C_AHA_CONFLICT_CASE_ID =
  'quick_ingredient_conflict_vitamin_c_aha';

const TARGET_DATE = '2026-05-29';

export const QUICK_SUGGESTION_GOLDEN_CASES: readonly TodaysSuggestionEvaluationCase[] =
  [
    ...TODAYS_SUGGESTION_GOLDEN_CASES.filter(
      (evaluationCase) =>
        evaluationCase.inputs.requestSource ===
        SuggestionRequestSource.OnDemand,
    ),
    buildPlainSkipDoesNotSuppressSpfCase(),
    buildCategoryOpenEveningCase(),
    buildQuickVitaminCNotCrowdedOutCase(),
    buildQuickToleratedRetinoidAfterExfoliatingCleanserCase(),
    buildQuickVitaminCNiacinamideConflictCase(),
    buildQuickRetinoidBhaConflictCase(),
    buildQuickRetinoidBenzoylConflictCase(),
    buildQuickVitaminCAhaConflictCase(),
    buildNoExtraStepNeededCase(),
  ];

function buildPlainSkipDoesNotSuppressSpfCase(): TodaysSuggestionEvaluationCase {
  const requestContext: SuggestionRequestContextJson = {
    intent: 'post_sun',
    intensity: 'minimal',
    note: 'I was outside at lunch and need the quickest useful step before more daylight.',
    activityAt: '2026-05-29T11:35:00.000Z',
    requestedAt: '2026-05-29T12:05:00.000Z',
  };
  const product = productWithPreferredTime({
    id: 'plain-skip-spf-1',
    name: 'Morning SPF 50',
    category: ProductCategory.SunProtection,
    preferredTimeOfDay: PreferredTimeOfDay.Morning,
  });
  const profile = skinProfile();
  const recentApplications = [
    applicationLog({
      targetDate: '2026-05-28',
      daypart: SuggestionDaypart.Noon,
      items: [
        applicationItem({
          product,
          status: ApplicationItemStatus.Skipped,
          notes: 'Stayed indoors and did not need SPF.',
        }),
      ],
    }),
  ];
  const contextSummary = buildContextSummary({
    cacheKey: QUICK_SUGGESTION_PLAIN_SKIP_CASE_ID,
    requestContext,
    profile,
    product,
    targetTime: '12:05',
    daypart: SuggestionDaypart.Noon,
    recentApplications,
    skippedByCategory: { [ProductCategory.SunProtection]: 1 },
    suitabilityReasons: [
      'Owned SPF fits the current noon daylight request.',
      'Plain prior skip had no reaction or intolerance evidence.',
    ],
  });

  return {
    id: QUICK_SUGGESTION_PLAIN_SKIP_CASE_ID,
    title: 'Plain skipped SPF remains eligible for daytime quick suggestion',
    riskFocus: ['on_demand', 'plain_skip_history', 'spf'],
    manualReviewChecklist: [
      'Does it recommend the owned SPF for the current daytime request?',
      'Does it avoid treating a non-reaction skip as a safety reason?',
      'Does it keep the quick suggestion minimal and right-now focused?',
    ],
    expected: {
      requiresOnDemandShape: true,
      requiresSpfProtection: true,
      requiredProductIds: [product.id],
      maxStepCount: 2,
    },
    inputs: {
      language: 'en',
      slotId: null,
      requestSource: SuggestionRequestSource.OnDemand,
      requestContext,
      scheduledSlotContext: null,
      targetDate: TARGET_DATE,
      targetTime: '12:05',
      daypart: SuggestionDaypart.Noon,
      skinProfile: profile,
      shelfActiveProducts: [product],
      shelfFinishedProductIds: [],
      routineSteps: [],
      recentJournalEntries: [],
      recentApplications,
      contextSummary,
      environmentSnapshotId: null,
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
  };
}

function buildNoExtraStepNeededCase(): TodaysSuggestionEvaluationCase {
  const requestContext: SuggestionRequestContextJson = {
    intent: 'quick_refresh',
    intensity: 'minimal',
    note: 'My skin feels comfortable and I am staying indoors. Do I need to apply anything else?',
    activityAt: null,
    requestedAt: '2026-05-29T20:30:00.000Z',
  };
  const product = productWithPreferredTime({
    id: 'morning-spf-only',
    name: 'Morning SPF 50',
    category: ProductCategory.SunProtection,
    preferredTimeOfDay: PreferredTimeOfDay.Morning,
  });
  const profile = skinProfile();
  const contextSummary = buildContextSummary({
    requestContext,
    profile,
    product,
  });

  return {
    id: QUICK_SUGGESTION_NO_STEP_CASE_ID,
    title: 'Comfortable indoor quick check returns no product steps',
    riskFocus: ['on_demand', 'no_unnecessary_products', 'preferred_time'],
    manualReviewChecklist: [
      'Does it clearly say no extra product is needed right now?',
      'Does it avoid using a morning-only SPF in an evening quick check?',
      'Does it avoid creating shopping pressure when no gap is needed?',
    ],
    expected: {
      requiresOnDemandShape: true,
      maxStepCount: 0,
      forbiddenProductIds: [product.id],
    },
    inputs: {
      language: 'en',
      slotId: null,
      requestSource: SuggestionRequestSource.OnDemand,
      requestContext,
      scheduledSlotContext: null,
      targetDate: TARGET_DATE,
      targetTime: '20:30',
      daypart: SuggestionDaypart.Evening,
      skinProfile: profile,
      shelfActiveProducts: [product],
      shelfFinishedProductIds: [],
      routineSteps: [],
      recentJournalEntries: [],
      recentApplications: [],
      contextSummary,
      environmentSnapshotId: null,
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
  };
}

function buildCategoryOpenEveningCase(): TodaysSuggestionEvaluationCase {
  const requestContext: SuggestionRequestContextJson = {
    intent: 'quick_refresh',
    intensity: 'minimal',
    note: 'My skin feels oily but tight after commuting. I have five minutes before bed and want one useful quick step.',
    activityAt: null,
    requestedAt: '2026-05-29T20:15:00.000Z',
  };
  const products = [
    productWithPreferredTime({
      id: 'quick-cleanser-1',
      name: 'Soft Cream Cleanser',
      category: ProductCategory.Cleanser,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['cleanser', 'gentle'],
      ingredients: ['water', 'glycerin', 'cocamidopropyl betaine'],
      description: 'Gentle cream cleanser.',
    }),
    productWithPreferredTime({
      id: 'quick-moisturizer-1',
      name: 'Barrier Cream',
      category: ProductCategory.Moisturizer,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['ceramide', 'barrier'],
      ingredients: ['water', 'glycerin', 'ceramide np', 'panthenol'],
      description: 'Barrier-support moisturizer.',
    }),
    productWithPreferredTime({
      id: 'quick-spf-1',
      name: 'Morning SPF 50',
      category: ProductCategory.SunProtection,
      preferredTimeOfDay: PreferredTimeOfDay.Morning,
    }),
    productWithPreferredTime({
      id: 'quick-toner-1',
      name: 'Soothing Toner',
      category: ProductCategory.Toner,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['soothing', 'panthenol'],
      ingredients: ['water', 'panthenol', 'allantoin'],
      description: 'Light soothing toner.',
    }),
    productWithPreferredTime({
      id: 'quick-essence-1',
      name: 'Barrier Essence',
      category: ProductCategory.Essence,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['barrier', 'hydrating'],
      ingredients: ['glycerin', 'beta-glucan', 'panthenol'],
      description: 'Hydrating barrier essence.',
    }),
    productWithPreferredTime({
      id: 'quick-mask-1',
      name: 'Calm Clay Mask',
      category: ProductCategory.Mask,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['oil-control', 'mask'],
      ingredients: ['kaolin', 'glycerin'],
      description: 'Oil-control clay mask.',
    }),
    productWithPreferredTime({
      id: 'quick-lip-1',
      name: 'Comfort Lip Balm',
      category: ProductCategory.LipCare,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['lip-care', 'barrier'],
      ingredients: ['petrolatum', 'shea butter'],
      description: 'Comfort lip balm.',
    }),
  ];
  const profile = skinProfile();
  profile.primary_goal = 'stay comfortable while reducing visible oiliness';
  profile.current_concerns = ['oiliness', 'tightness', 'dullness'];
  profile.routine_preferences = {
    pace: 'minimal',
    am_minutes: 5,
    pm_minutes: 5,
  };
  const contextSummary = buildContextSummary({
    cacheKey: QUICK_SUGGESTION_CATEGORY_OPEN_CASE_ID,
    requestContext,
    profile,
    products,
    targetTime: '20:15',
    daypart: SuggestionDaypart.Evening,
    productScoreOverrides: {
      'quick-cleanser-1': {
        suitabilityScore: 72,
        suitabilityReasons: [
          'Compatible with evening, but the request says tightness and asks for one useful quick step before bed.',
        ],
      },
      'quick-moisturizer-1': {
        suitabilityScore: 78,
        suitabilityReasons: [
          'Compatible with tightness, but other owned support products are more specific to the right-now request.',
        ],
      },
      'quick-toner-1': {
        suitabilityScore: 94,
        suitabilityReasons: [
          'Owned soothing toner fits tightness and dullness as a quick one-step support product.',
        ],
      },
      'quick-essence-1': {
        suitabilityScore: 92,
        suitabilityReasons: [
          'Owned barrier essence fits tightness and comfort without requiring a full routine.',
        ],
      },
      'quick-mask-1': {
        suitabilityScore: 88,
        suitabilityReasons: [
          'Owned clay mask fits visible oiliness, but it is less quick than leave-on support.',
        ],
      },
      'quick-lip-1': {
        suitabilityScore: 65,
        suitabilityReasons: [
          'Owned lip balm is compatible but does not address the face comfort request.',
        ],
      },
    },
  });

  return {
    id: QUICK_SUGGESTION_CATEGORY_OPEN_CASE_ID,
    title:
      'Quick evening suggestion can use uploaded non-serum support categories',
    riskFocus: [
      'on_demand',
      'category_open_selection',
      'unnecessary_basic_only_repeat',
    ],
    manualReviewChecklist: [
      'Does it answer the right-now request without forcing a full routine?',
      'Does it consider uploaded toner, essence, mask, or lip-care categories when compatible?',
      'Does it avoid cleanser/moisturizer/SPF-only collapse without inventing products?',
    ],
    expected: {
      requiresOnDemandShape: true,
      minStepCount: 1,
      maxStepCount: 3,
      minSelectedNonBasicCategoryCount: 1,
      forbiddenProductIds: ['quick-spf-1'],
    },
    inputs: {
      language: 'en',
      slotId: null,
      requestSource: SuggestionRequestSource.OnDemand,
      requestContext,
      scheduledSlotContext: null,
      targetDate: TARGET_DATE,
      targetTime: '20:15',
      daypart: SuggestionDaypart.Evening,
      skinProfile: profile,
      shelfActiveProducts: products,
      shelfFinishedProductIds: [],
      routineSteps: [],
      recentJournalEntries: [],
      recentApplications: [],
      contextSummary,
      environmentSnapshotId: null,
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
  };
}

function buildQuickVitaminCNotCrowdedOutCase(): TodaysSuggestionEvaluationCase {
  const requestContext: SuggestionRequestContextJson = {
    intent: 'quick_refresh',
    intensity: 'standard',
    note: 'I am heading out and want quick support for dark marks without a full routine.',
    activityAt: null,
    requestedAt: '2026-05-29T08:05:00.000Z',
  };
  const products = [
    productWithPreferredTime({
      id: 'quick-spf-1',
      name: 'Morning SPF 50',
      category: ProductCategory.SunProtection,
      preferredTimeOfDay: PreferredTimeOfDay.Morning,
    }),
    productWithPreferredTime({
      id: 'quick-niacinamide-1',
      name: 'Niacinamide Serum',
      category: ProductCategory.Serum,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['niacinamide'],
      ingredients: ['niacinamide', 'glycerin'],
      description: 'Light serum for oil balance and barrier support.',
    }),
    productWithPreferredTime({
      id: 'quick-vitamin-c-1',
      name: 'Ascorbyl Glucoside Solution 12%',
      category: ProductCategory.Serum,
      preferredTimeOfDay: PreferredTimeOfDay.Morning,
      tags: ['vitamin_c', 'antioxidant', 'pigment-support'],
      ingredients: ['ascorbyl glucoside', 'glycerin'],
      description: 'Vitamin C derivative serum for uneven tone and dark marks.',
    }),
  ];
  const profile = skinProfile();
  profile.primary_goal = 'fade post-acne dark marks';
  profile.current_concerns = ['dark marks', 'uneven tone'];
  profile.routine_preferences = {
    pace: 'steady',
    am_minutes: 10,
    pm_minutes: 10,
  };
  const contextSummary = buildContextSummary({
    cacheKey: 'quick_vitamin_c_morning_not_crowded_out',
    requestContext,
    profile,
    products,
    targetTime: '08:05',
    daypart: SuggestionDaypart.Morning,
    productScoreOverrides: {
      'quick-vitamin-c-1': {
        suitabilityScore: 96,
        suitabilityReasons: [
          'Owned Vitamin C directly fits the dark-mark quick request.',
        ],
      },
      'quick-niacinamide-1': {
        suitabilityScore: 86,
        suitabilityReasons: [
          'Owned niacinamide is compatible, but less direct than Vitamin C for this quick pigment request.',
        ],
      },
    },
  });

  return {
    id: 'quick_vitamin_c_morning_not_crowded_out',
    title: 'Quick morning pigment request considers Vitamin C separately',
    riskFocus: ['on_demand', 'same_category_selection', 'pigment_support'],
    manualReviewChecklist: [
      'Does it select the owned Vitamin C when it is the most direct quick pigment support?',
      'Does it avoid selecting niacinamide instead solely because both products are serums?',
      'Does it keep the quick suggestion small and right-now focused?',
    ],
    expected: {
      requiresOnDemandShape: true,
      requiresSpfProtection: true,
      requiredProductIds: ['quick-spf-1', 'quick-vitamin-c-1'],
      maxStepCount: 3,
    },
    inputs: {
      language: 'en',
      slotId: null,
      requestSource: SuggestionRequestSource.OnDemand,
      requestContext,
      scheduledSlotContext: null,
      targetDate: TARGET_DATE,
      targetTime: '08:05',
      daypart: SuggestionDaypart.Morning,
      skinProfile: profile,
      shelfActiveProducts: products,
      shelfFinishedProductIds: [],
      routineSteps: [],
      recentJournalEntries: [],
      recentApplications: [],
      contextSummary,
      environmentSnapshotId: null,
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
  };
}

function buildQuickToleratedRetinoidAfterExfoliatingCleanserCase(): TodaysSuggestionEvaluationCase {
  const requestContext: SuggestionRequestContextJson = {
    intent: 'quick_refresh',
    intensity: 'standard',
    note: 'I already cleansed before bed. I want a useful leave-on step for post-acne marks and rough texture.',
    activityAt: null,
    requestedAt: '2026-05-29T21:10:00.000Z',
  };
  const products = [
    productWithPreferredTime({
      id: 'quick-sa-cleanser-1',
      name: 'SA Smoothing Cleanser',
      category: ProductCategory.Cleanser,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['cleanser', 'bha', 'salicylic'],
      ingredients: ['water', 'glycerin', 'salicylic acid'],
      description: 'Rinse-off salicylic acid cleanser for congestion.',
    }),
    productWithPreferredTime({
      id: 'quick-retinoid-1',
      name: '1% Retinol Treatment',
      category: ProductCategory.Treatment,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['retinoid', 'retinol', 'pigment-support'],
      ingredients: ['retinol', 'tetrahexyldecyl ascorbate', 'ceramide ng'],
      description:
        'Retinol treatment for post-acne marks, texture, pores, and uneven tone.',
    }),
    productWithPreferredTime({
      id: 'quick-moisturizer-1',
      name: 'Barrier Cream',
      category: ProductCategory.Moisturizer,
      preferredTimeOfDay: PreferredTimeOfDay.Either,
      tags: ['ceramide', 'barrier'],
      ingredients: ['water', 'glycerin', 'ceramide np', 'panthenol'],
      description: 'Barrier-support moisturizer.',
    }),
  ];
  const profile = skinProfile();
  profile.primary_goal = 'fade post-acne marks and improve texture';
  profile.current_concerns = [
    'hyperpigmentation',
    'post-acne marks',
    'texture',
    'large pores',
  ];
  profile.active_tolerances = {
    retinoid: { tolerance: 'good', last_used: null },
  };
  profile.routine_preferences = {
    pace: 'steady',
    am_minutes: 10,
    pm_minutes: 10,
  };
  const recentApplications = [
    applicationLog({
      targetDate: TARGET_DATE,
      daypart: SuggestionDaypart.Evening,
      items: [
        applicationItem({
          product: products[0],
          status: ApplicationItemStatus.Applied,
          notes:
            'Already cleansed before this quick request; tolerated well, no burning, stinging, redness, or reaction.',
        }),
      ],
    }),
  ];
  const contextSummary = buildContextSummary({
    cacheKey: QUICK_SUGGESTION_TOLERATED_RETINOID_CASE_ID,
    requestContext,
    profile,
    products,
    targetTime: '21:10',
    daypart: SuggestionDaypart.Evening,
    recentApplications,
    safetyConstraints: ['space_strong_actives'],
    appliedProductHistory: {
      windowStartDate: '2026-05-28',
      windowEndDate: TARGET_DATE,
      recordsConsidered: 1,
      products: [
        {
          productId: 'quick-sa-cleanser-1',
          brand: 'Ava Lab',
          name: 'SA Smoothing Cleanser',
          category: ProductCategory.Cleanser,
          stepLabel: ProductCategory.Cleanser,
          sourceTypes: ['recommended'],
          dayparts: [SuggestionDaypart.Evening],
          statuses: [ApplicationItemStatus.Applied],
          useCount: 1,
          lastAppliedDate: TARGET_DATE,
          lastAppliedAt: '2026-05-29T20:40:00.000Z',
          isOffShelf: false,
          isSubstitution: false,
        },
      ],
    },
    productScoreOverrides: {
      'quick-sa-cleanser-1': {
        suitabilityScore: 56,
        suitabilityReasons: [
          'Owned rinse-off BHA cleanser was already used before this quick request and should not be repeated now or block tolerated retinol.',
        ],
      },
      'quick-retinoid-1': {
        suitabilityScore: 97,
        suitabilityReasons: [
          'Owned tolerated retinol directly fits post-acne marks, texture, and pores for this evening quick request.',
        ],
      },
      'quick-moisturizer-1': {
        suitabilityScore: 88,
        suitabilityReasons: [
          'Owned barrier cream is compatible support after a retinoid step.',
        ],
      },
    },
  });

  return {
    id: QUICK_SUGGESTION_TOLERATED_RETINOID_CASE_ID,
    title:
      'Quick evening suggestion keeps tolerated retinoid after exfoliating cleanser history',
    riskFocus: [
      'on_demand',
      'tolerated_active_eligibility',
      'exfoliating_cleanser_history',
    ],
    manualReviewChecklist: [
      'Does it select the owned tolerated retinol for the current evening mark and texture request?',
      'Does it avoid treating a rinse-off BHA cleanser as a leave-on strong active that blocks retinol?',
      'Does it avoid deterministic fallback while keeping the quick suggestion small?',
    ],
    expected: {
      requiresOnDemandShape: true,
      requiredProductIds: ['quick-retinoid-1'],
      forbiddenProductIds: ['quick-sa-cleanser-1'],
      maxStepCount: 2,
    },
    inputs: {
      language: 'en',
      slotId: null,
      requestSource: SuggestionRequestSource.OnDemand,
      requestContext,
      scheduledSlotContext: null,
      targetDate: TARGET_DATE,
      targetTime: '21:10',
      daypart: SuggestionDaypart.Evening,
      skinProfile: profile,
      shelfActiveProducts: products,
      shelfFinishedProductIds: [],
      routineSteps: [],
      recentJournalEntries: [],
      recentApplications,
      contextSummary,
      environmentSnapshotId: null,
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
  };
}

function buildQuickVitaminCNiacinamideConflictCase(): TodaysSuggestionEvaluationCase {
  const requestContext: SuggestionRequestContextJson = {
    intent: 'quick_refresh',
    intensity: 'standard',
    note: 'I am going out soon and want quick support for dark marks without irritating my skin.',
    activityAt: null,
    requestedAt: '2026-05-29T08:25:00.000Z',
  };
  const products = [
    quickCleanser(),
    quickMoisturizer(),
    quickSpf(),
    quickVitaminCSerum(),
    quickNiacinamideSerum(),
  ];
  const profile = skinProfile();
  profile.primary_goal = 'fade post-acne dark marks without irritation';
  profile.current_concerns = ['dark marks', 'uneven tone', 'oiliness'];
  profile.active_tolerances = {
    vitamin_c: { tolerance: 'medium' },
    niacinamide: { tolerance: 'good' },
  };
  profile.routine_preferences = {
    pace: 'steady',
    am_minutes: 8,
    pm_minutes: 8,
  };
  const contextSummary = buildContextSummary({
    cacheKey: QUICK_SUGGESTION_VITAMIN_C_NIACINAMIDE_CONFLICT_CASE_ID,
    requestContext,
    profile,
    products,
    targetTime: '08:25',
    daypart: SuggestionDaypart.Morning,
    ingredientConflicts: [
      ingredientConflict({
        id: 'quick-conflict-vitamin-c-niacinamide',
        code: 'avoid_pairing_vitamin_c_niacinamide',
        productIds: ['quick-vitamin-c-1', 'quick-niacinamide-1'],
        ingredientNames: ['Vitamin C', 'Niacinamide'],
        description:
          'Ingredient intelligence says these products should be split between routines if sensitivity, stinging, or flushing is possible.',
        mitigation:
          'Choose one serum now and use the other in another routine.',
      }),
    ],
    productScoreOverrides: {
      'quick-vitamin-c-1': {
        suitabilityScore: 95,
        suitabilityReasons: [
          'Owned Vitamin C directly supports the current dark-mark request.',
        ],
      },
      'quick-niacinamide-1': {
        suitabilityScore: 90,
        suitabilityReasons: [
          'Owned niacinamide supports oil balance and tone, but ingredient intelligence says it should not be layered with the Vitamin C serum in this routine.',
        ],
      },
    },
  });

  return {
    id: QUICK_SUGGESTION_VITAMIN_C_NIACINAMIDE_CONFLICT_CASE_ID,
    title: 'Quick morning suggestion does not pair conflict-marked serums',
    riskFocus: ['on_demand', 'ingredient_conflict', 'serum_layering'],
    manualReviewChecklist: [
      'Does it choose one serum path instead of pairing both conflict-marked serums?',
      'Does it still keep SPF present for a daytime pigment request?',
      'Does it explain the chosen path using product data rather than generic scoring copy?',
    ],
    expected: {
      requiresOnDemandShape: true,
      requiresSpfProtection: true,
      requiredProductIds: ['quick-spf-1'],
      requiredAnyProductIds: [['quick-vitamin-c-1', 'quick-niacinamide-1']],
      minSelectedNonBasicCategoryCount: 1,
      maxStepCount: 4,
    },
    inputs: quickInputs({
      requestContext,
      profile,
      products,
      contextSummary,
      targetTime: '08:25',
      daypart: SuggestionDaypart.Morning,
    }),
  };
}

function buildQuickRetinoidBhaConflictCase(): TodaysSuggestionEvaluationCase {
  const requestContext: SuggestionRequestContextJson = {
    intent: 'quick_refresh',
    intensity: 'standard',
    note: 'Before bed I want a useful step for texture and clogged pores.',
    activityAt: null,
    requestedAt: '2026-05-29T21:20:00.000Z',
  };
  const products = [
    quickCleanser(),
    quickMoisturizer(),
    quickRetinoidTreatment(),
    quickBhaExfoliant(),
  ];
  const profile = skinProfile();
  profile.primary_goal = 'smooth texture and reduce clogged pores';
  profile.current_concerns = ['texture', 'clogged pores', 'post-acne marks'];
  profile.active_tolerances = {
    retinoid: { tolerance: 'good' },
    bha: { tolerance: 'medium' },
  };
  profile.routine_preferences = {
    pace: 'steady',
    am_minutes: 8,
    pm_minutes: 10,
  };
  const contextSummary = buildContextSummary({
    cacheKey: QUICK_SUGGESTION_RETINOID_BHA_CONFLICT_CASE_ID,
    requestContext,
    profile,
    products,
    targetTime: '21:20',
    daypart: SuggestionDaypart.Evening,
    ingredientConflicts: [
      ingredientConflict({
        id: 'quick-conflict-retinoid-bha',
        code: 'avoid_pairing_retinoid_bha',
        productIds: ['quick-retinoid-1', 'quick-bha-1'],
        ingredientNames: ['Retinoid', 'BHA'],
        description:
          'Ingredient intelligence says retinoids and leave-on BHA should not be layered in the same quick routine because irritation risk can increase.',
        mitigation:
          'Choose one active route now and alternate the other later.',
      }),
    ],
    productScoreOverrides: {
      'quick-retinoid-1': {
        suitabilityScore: 96,
        suitabilityReasons: [
          'Owned tolerated retinoid fits texture and post-acne marks for this evening quick request.',
        ],
      },
      'quick-bha-1': {
        suitabilityScore: 91,
        suitabilityReasons: [
          'Owned BHA fits clogged pores, but ingredient intelligence says not to layer it with the retinoid in this same routine.',
        ],
      },
    },
  });

  return {
    id: QUICK_SUGGESTION_RETINOID_BHA_CONFLICT_CASE_ID,
    title: 'Quick evening suggestion selects one retinoid or BHA route',
    riskFocus: ['on_demand', 'ingredient_conflict', 'retinoid', 'bha'],
    manualReviewChecklist: [
      'Does it avoid pairing retinoid and leave-on BHA in the same quick routine?',
      'Does it still choose one current-data-supported active route?',
    ],
    expected: {
      requiresOnDemandShape: true,
      requiredAnyProductIds: [['quick-retinoid-1', 'quick-bha-1']],
      minSelectedNonBasicCategoryCount: 1,
      maxStrongActiveCount: 1,
      maxStepCount: 3,
    },
    inputs: quickInputs({
      requestContext,
      profile,
      products,
      contextSummary,
      targetTime: '21:20',
      daypart: SuggestionDaypart.Evening,
    }),
  };
}

function buildQuickRetinoidBenzoylConflictCase(): TodaysSuggestionEvaluationCase {
  const requestContext: SuggestionRequestContextJson = {
    intent: 'quick_refresh',
    intensity: 'standard',
    note: 'I have a few breakouts tonight and want one useful treatment step.',
    activityAt: null,
    requestedAt: '2026-05-29T21:35:00.000Z',
  };
  const products = [
    quickCleanser(),
    quickMoisturizer(),
    quickRetinoidTreatment(),
    quickBenzoylTreatment(),
  ];
  const profile = skinProfile();
  profile.primary_goal = 'reduce breakouts while protecting my skin barrier';
  profile.current_concerns = ['acne', 'post-acne marks', 'texture'];
  profile.active_tolerances = {
    retinoid: { tolerance: 'good' },
    benzoyl_peroxide: { tolerance: 'medium' },
  };
  profile.routine_preferences = {
    pace: 'steady',
    am_minutes: 8,
    pm_minutes: 10,
  };
  const contextSummary = buildContextSummary({
    cacheKey: QUICK_SUGGESTION_RETINOID_BENZOYL_CONFLICT_CASE_ID,
    requestContext,
    profile,
    products,
    targetTime: '21:35',
    daypart: SuggestionDaypart.Evening,
    ingredientConflicts: [
      ingredientConflict({
        id: 'quick-conflict-retinoid-benzoyl',
        code: 'avoid_pairing_retinoid_benzoyl_peroxide',
        productIds: ['quick-retinoid-1', 'quick-benzoyl-1'],
        ingredientNames: ['Retinoid', 'Benzoyl peroxide'],
        description:
          'Ingredient intelligence says retinoids and benzoyl peroxide should not be layered in this routine because irritation or reduced comfort can increase.',
        mitigation:
          'Choose one acne path now and use the other in a separate routine.',
      }),
    ],
    productScoreOverrides: {
      'quick-retinoid-1': {
        suitabilityScore: 94,
        suitabilityReasons: [
          'Owned tolerated retinoid supports post-acne marks and texture.',
        ],
      },
      'quick-benzoyl-1': {
        suitabilityScore: 93,
        suitabilityReasons: [
          'Owned benzoyl peroxide treatment fits current breakout support, but ingredient intelligence says not to layer it with retinoid in the same routine.',
        ],
      },
    },
  });

  return {
    id: QUICK_SUGGESTION_RETINOID_BENZOYL_CONFLICT_CASE_ID,
    title: 'Quick acne suggestion avoids retinoid and benzoyl stacking',
    riskFocus: [
      'on_demand',
      'ingredient_conflict',
      'retinoid',
      'benzoyl_peroxide',
    ],
    manualReviewChecklist: [
      'Does it choose one acne-relevant active route instead of stacking both conflict-marked products?',
      'Does it avoid inventing a reaction when the reason is supplied ingredient intelligence?',
    ],
    expected: {
      requiresOnDemandShape: true,
      requiredAnyProductIds: [['quick-retinoid-1', 'quick-benzoyl-1']],
      minSelectedNonBasicCategoryCount: 1,
      maxStrongActiveCount: 1,
      maxStepCount: 3,
    },
    inputs: quickInputs({
      requestContext,
      profile,
      products,
      contextSummary,
      targetTime: '21:35',
      daypart: SuggestionDaypart.Evening,
    }),
  };
}

function buildQuickVitaminCAhaConflictCase(): TodaysSuggestionEvaluationCase {
  const requestContext: SuggestionRequestContextJson = {
    intent: 'quick_refresh',
    intensity: 'standard',
    note: 'I want a quick morning step for dullness and dark marks before leaving.',
    activityAt: null,
    requestedAt: '2026-05-29T08:40:00.000Z',
  };
  const products = [
    quickCleanser(),
    quickMoisturizer(),
    quickSpf(),
    quickVitaminCSerum(),
    quickAhaToner(),
  ];
  const profile = skinProfile();
  profile.primary_goal = 'brighten uneven tone without over-exfoliating';
  profile.current_concerns = ['dark marks', 'dullness', 'texture'];
  profile.active_tolerances = {
    vitamin_c: { tolerance: 'medium' },
    aha: { tolerance: 'medium' },
  };
  profile.routine_preferences = {
    pace: 'steady',
    am_minutes: 8,
    pm_minutes: 8,
  };
  const contextSummary = buildContextSummary({
    cacheKey: QUICK_SUGGESTION_VITAMIN_C_AHA_CONFLICT_CASE_ID,
    requestContext,
    profile,
    products,
    targetTime: '08:40',
    daypart: SuggestionDaypart.Morning,
    ingredientConflicts: [
      ingredientConflict({
        id: 'quick-conflict-vitamin-c-aha',
        code: 'avoid_pairing_vitamin_c_aha',
        productIds: ['quick-vitamin-c-1', 'quick-aha-1'],
        ingredientNames: ['Vitamin C', 'AHA'],
        description:
          'Ingredient intelligence says Vitamin C and AHA should not be stacked in the same quick morning routine because irritation risk can increase.',
        mitigation:
          'Choose one brightening route now and use the other separately.',
      }),
    ],
    productScoreOverrides: {
      'quick-vitamin-c-1': {
        suitabilityScore: 95,
        suitabilityReasons: [
          'Owned Vitamin C directly supports the current dark-mark quick request.',
        ],
      },
      'quick-aha-1': {
        suitabilityScore: 91,
        suitabilityReasons: [
          'Owned AHA toner fits dullness and texture, but ingredient intelligence says not to layer it with Vitamin C in this same routine.',
        ],
      },
    },
  });

  return {
    id: QUICK_SUGGESTION_VITAMIN_C_AHA_CONFLICT_CASE_ID,
    title: 'Quick morning suggestion avoids Vitamin C and AHA stacking',
    riskFocus: ['on_demand', 'ingredient_conflict', 'vitamin_c', 'aha'],
    manualReviewChecklist: [
      'Does it avoid pairing Vitamin C and AHA in the same quick routine?',
      'Does it keep SPF present for a daytime brightening request?',
    ],
    expected: {
      requiresOnDemandShape: true,
      requiresSpfProtection: true,
      requiredProductIds: ['quick-spf-1'],
      requiredAnyProductIds: [['quick-vitamin-c-1', 'quick-aha-1']],
      minSelectedNonBasicCategoryCount: 1,
      maxStrongActiveCount: 1,
      maxStepCount: 4,
    },
    inputs: quickInputs({
      requestContext,
      profile,
      products,
      contextSummary,
      targetTime: '08:40',
      daypart: SuggestionDaypart.Morning,
    }),
  };
}

function quickInputs(input: {
  requestContext: SuggestionRequestContextJson;
  profile: SkinProfile;
  products: readonly InventoryProduct[];
  contextSummary: SuggestionContextSummary;
  targetTime: string;
  daypart: SuggestionDaypart;
}): TodaysSuggestionEvaluationCase['inputs'] {
  return {
    language: 'en',
    slotId: null,
    requestSource: SuggestionRequestSource.OnDemand,
    requestContext: input.requestContext,
    scheduledSlotContext: null,
    targetDate: TARGET_DATE,
    targetTime: input.targetTime,
    daypart: input.daypart,
    skinProfile: input.profile,
    shelfActiveProducts: [...input.products],
    shelfFinishedProductIds: [],
    routineSteps: [],
    recentJournalEntries: [],
    recentApplications: [],
    contextSummary: input.contextSummary,
    environmentSnapshotId: null,
    aiPersonalizationAllowed: true,
    aiPersonalizationBlockedReason: null,
  };
}

function quickCleanser(): InventoryProduct {
  return productWithPreferredTime({
    id: 'quick-cleanser-1',
    name: 'Soft Cream Cleanser',
    category: ProductCategory.Cleanser,
    preferredTimeOfDay: PreferredTimeOfDay.Either,
    tags: ['cleanser', 'gentle'],
    ingredients: ['water', 'glycerin', 'cocamidopropyl betaine'],
    description: 'Gentle cream cleanser.',
  });
}

function quickMoisturizer(): InventoryProduct {
  return productWithPreferredTime({
    id: 'quick-moisturizer-1',
    name: 'Barrier Cream',
    category: ProductCategory.Moisturizer,
    preferredTimeOfDay: PreferredTimeOfDay.Either,
    tags: ['ceramide', 'barrier'],
    ingredients: ['water', 'glycerin', 'ceramide np', 'panthenol'],
    description: 'Barrier-support moisturizer.',
  });
}

function quickSpf(): InventoryProduct {
  return productWithPreferredTime({
    id: 'quick-spf-1',
    name: 'Morning SPF 50',
    category: ProductCategory.SunProtection,
    preferredTimeOfDay: PreferredTimeOfDay.Morning,
    tags: ['spf', 'sun-protection'],
    ingredients: ['zinc oxide'],
    description: 'Broad-spectrum SPF 50.',
  });
}

function quickVitaminCSerum(): InventoryProduct {
  return productWithPreferredTime({
    id: 'quick-vitamin-c-1',
    name: 'Ascorbyl Glucoside Solution 12%',
    category: ProductCategory.Serum,
    preferredTimeOfDay: PreferredTimeOfDay.Morning,
    tags: ['vitamin_c', 'antioxidant', 'pigment-support'],
    ingredients: ['ascorbyl glucoside', 'glycerin'],
    description: 'Vitamin C derivative serum for uneven tone and dark marks.',
  });
}

function quickNiacinamideSerum(): InventoryProduct {
  return productWithPreferredTime({
    id: 'quick-niacinamide-1',
    name: 'Niacinamide 10% + Zinc 1%',
    category: ProductCategory.Serum,
    preferredTimeOfDay: PreferredTimeOfDay.Either,
    tags: ['niacinamide', 'oil-control', 'barrier'],
    ingredients: ['niacinamide', 'zinc pca', 'glycerin'],
    description:
      'Niacinamide serum for oil balance, tone, and barrier support.',
  });
}

function quickRetinoidTreatment(): InventoryProduct {
  return productWithPreferredTime({
    id: 'quick-retinoid-1',
    name: '1% Retinol Treatment',
    category: ProductCategory.Treatment,
    preferredTimeOfDay: PreferredTimeOfDay.Either,
    tags: ['retinoid', 'retinol', 'pigment-support'],
    ingredients: ['retinol', 'ceramide ng', 'licorice root extract'],
    description:
      'Retinol treatment for post-acne marks, texture, pores, and uneven tone.',
  });
}

function quickBhaExfoliant(): InventoryProduct {
  return productWithPreferredTime({
    id: 'quick-bha-1',
    name: 'Skin Perfecting 2% BHA Liquid Exfoliant',
    category: ProductCategory.Exfoliant,
    preferredTimeOfDay: PreferredTimeOfDay.Either,
    tags: ['bha', 'salicylic', 'exfoliant'],
    ingredients: ['salicylic acid', 'green tea extract'],
    description: 'Leave-on BHA exfoliant for clogged pores and texture.',
  });
}

function quickBenzoylTreatment(): InventoryProduct {
  return productWithPreferredTime({
    id: 'quick-benzoyl-1',
    name: 'Benzoyl Peroxide Treatment',
    category: ProductCategory.Treatment,
    preferredTimeOfDay: PreferredTimeOfDay.Either,
    tags: ['benzoyl_peroxide', 'acne'],
    ingredients: ['benzoyl peroxide'],
    description: 'Acne treatment for active breakouts.',
  });
}

function quickAhaToner(): InventoryProduct {
  return productWithPreferredTime({
    id: 'quick-aha-1',
    name: 'Glycolic Acid Toner',
    category: ProductCategory.Toner,
    preferredTimeOfDay: PreferredTimeOfDay.Either,
    tags: ['aha', 'glycolic', 'exfoliant'],
    ingredients: ['glycolic acid', 'aloe vera'],
    description: 'AHA toner for dullness, uneven tone, and texture.',
  });
}

function ingredientConflict(input: {
  id: string;
  code: string;
  productIds: [string, string];
  ingredientNames: [string, string];
  description: string;
  mitigation: string;
}): SuggestionIngredientConflictSummary {
  return {
    id: input.id,
    code: input.code,
    severity: AnalysisSeverity.Medium,
    productIds: input.productIds,
    ingredientNames: input.ingredientNames,
    description: input.description,
    mitigation: input.mitigation,
  };
}

function productWithPreferredTime(input: {
  id: string;
  name: string;
  category: ProductCategory;
  preferredTimeOfDay: PreferredTimeOfDay;
  tags?: string[];
  ingredients?: string[];
  description?: string;
}): InventoryProduct {
  const tags = input.tags ?? ['spf'];
  const product = new InventoryProduct();
  product.id = input.id;
  product.user_id = 'quick-eval-user';
  product.brand = 'Ava Lab';
  product.name = input.name;
  product.category = input.category;
  product.barcode = null;
  product.status = ShelfStatus.Active;
  product.provenance = DataProvenance.PhotoLookup;
  product.brand_search = 'ava lab';
  product.name_search = input.name.toLowerCase();
  product.search_document = `Ava Lab ${input.name}`;
  product.opened_at = null;
  product.expires_at = null;
  product.period_after_opening_months = null;
  product.effective_expires_at = null;
  product.identity = {
    brand: 'Ava Lab',
    name: input.name,
    category: input.category,
    barcode: null,
    imageUrls: [],
    sizeMl: null,
    description: input.description ?? 'Broad-spectrum daily sunscreen.',
    benefits: tags,
    suitedFor: tags,
    inciIngredients: input.ingredients ?? ['zinc oxide'],
    inciLastConfirmedAt: '2026-05-01',
  };
  product.guidance = {
    applicationMethod: ApplicationMethod.Fingertips,
    quantity: Quantity.Generous,
    steps: ['Apply in the morning.'],
    cautions: [],
    waitMinutes: null,
  };
  product.manufacturer = {
    brand: 'Ava Lab',
    parentCompany: null,
    countryOfOrigin: null,
    countryOfManufacture: null,
    supportEmail: null,
    productUrl: null,
    websiteUrl: null,
  };
  product.user_fields = {
    openedAt: null,
    expiresAt: null,
    periodAfterOpeningMonths: null,
    pricePaid: null,
    pricePaidCurrency: null,
    purchasedFrom: null,
    personalNotes: null,
    preferredTimeOfDay: input.preferredTimeOfDay,
  };
  product.created_at = new Date('2026-05-01T08:00:00.000Z');
  product.updated_at = new Date('2026-05-01T08:00:00.000Z');
  return product;
}

function skinProfile(): SkinProfile {
  const profile = new SkinProfile();
  profile.id = 'quick-eval-profile';
  profile.user_id = 'quick-eval-user';
  profile.skin_type = 'normal';
  profile.skin_tone = null;
  profile.ethnicity = null;
  profile.country_code = null;
  profile.city = null;
  profile.fitzpatrick_phototype = null;
  profile.sensitivity_level = 'low';
  profile.hydration_level = null;
  profile.primary_goal = 'maintain calm skin';
  profile.current_concerns = [];
  profile.pregnancy_status = null;
  profile.safety_context = {
    conditions: [],
    medications: [],
    photosensitizing_other: false,
  };
  profile.under_dermatologist_care = null;
  profile.allow_smart_picks = true;
  profile.budget_tier = null;
  profile.reaction_history = {};
  profile.concern_details = {};
  profile.skin_behavior = {};
  profile.active_tolerances = {};
  profile.routine_preferences = {
    pace: 'minimal',
    am_minutes: 5,
    pm_minutes: 5,
  };
  profile.lifestyle_context = {};
  profile.shopping_preferences = {};
  profile.hormonal_context = {};
  profile.created_at = new Date('2026-05-01T08:00:00.000Z');
  profile.updated_at = new Date('2026-05-01T08:00:00.000Z');
  return profile;
}

function buildContextSummary(input: {
  cacheKey?: string;
  requestContext: SuggestionRequestContextJson;
  profile: SkinProfile;
  product?: InventoryProduct;
  products?: readonly InventoryProduct[];
  targetTime?: string;
  daypart?: SuggestionDaypart;
  recentApplications?: ApplicationLog[];
  skippedByCategory?: Record<string, number>;
  safetyConstraints?: string[];
  appliedProductHistory?: SuggestionContextSummary['appliedProductHistory'];
  ingredientConflicts?: readonly SuggestionIngredientConflictSummary[];
  suitabilityReasons?: string[];
  productScoreOverrides?: Record<
    string,
    {
      suitabilityScore?: number;
      suitabilityReasons?: string[];
    }
  >;
}): SuggestionContextSummary {
  const targetTime = input.targetTime ?? '20:30';
  const daypart = input.daypart ?? SuggestionDaypart.Evening;
  const products = input.products ?? (input.product ? [input.product] : []);
  const evidenceSourceIds = quickEvaluationEvidenceSourceIds(
    input.profile,
    products,
  );
  return {
    cacheKey: input.cacheKey ?? 'quick-eval-no-extra-step',
    builtAt: `2026-05-29T${targetTime}:00.000Z`,
    targetDate: TARGET_DATE,
    targetTime,
    daypart,
    requestSource: SuggestionRequestSource.OnDemand,
    onDemand: input.requestContext,
    skinProfile: {
      primaryGoal: input.profile.primary_goal,
      skinType: input.profile.skin_type,
      sensitivityLevel: input.profile.sensitivity_level,
      activeConcerns: input.profile.current_concerns,
      pregnancyStatus: input.profile.pregnancy_status,
    },
    profileSignals: {
      safety: {
        pregnancyStatus: null,
        underDermatologistCare: null,
        conditions: [],
        medications: [],
        photosensitizingOther: false,
        recentProcedures: [],
      },
      routinePreferences: {
        pace: 'minimal',
        amMinutes: 5,
        pmMinutes: 5,
        maxActiveNightsPerWeek: null,
        fragranceFree: null,
        nonComedogenic: null,
        sunscreenFilter: null,
        sunscreenFinish: null,
      },
      skinBehavior: {
        burnTendency: null,
        tanTendency: null,
        pihTendency: null,
        melasmaTendency: null,
        sunscreenHabit: null,
        sunscreenTolerance: null,
      },
      shoppingPreferences: {
        ingredientDislikes: [],
        productDislikes: [],
        brandDislikes: [],
        texturePreferences: [],
      },
      activeTolerances: [],
    },
    reaction: {
      hasSignal: false,
      severity: null,
      confidence: null,
      indicators: [],
      affectedZones: [],
      concernKeys: [],
      daysSinceLatestSignal: null,
      barrierCompromised: false,
      photoInputImages: 0,
      multiAnglePhotoEntries: 0,
    },
    routineBreak: {
      recentlyResumed: false,
      lastPausedFrom: null,
      lastPausedUntil: null,
    },
    environment: null,
    productScores: products.map((product) => {
      const override = input.productScoreOverrides?.[product.id];
      return {
        productId: product.id,
        brand: product.brand,
        name: product.name,
        category: product.category,
        preferredTimeOfDay:
          product.user_fields?.preferredTimeOfDay ?? PreferredTimeOfDay.Either,
        activeTags: product.identity?.benefits ?? [],
        suitabilityScore:
          override?.suitabilityScore ??
          (product.category === ProductCategory.SunProtection ? 92 : 86),
        suitabilityReasons:
          override?.suitabilityReasons ??
          (input.suitabilityReasons && product.id === input.product?.id
            ? input.suitabilityReasons
            : defaultSuitabilityReasons(product)),
        cautionReasons: [],
        waitMinutes: null,
        inciQuality: 'available',
        dataQuality: 'verified',
        dataQualityWarnings: [],
        ingredientConflicts: input.ingredientConflicts?.filter((conflict) =>
          conflict.productIds.includes(product.id),
        ),
        evidenceSourceIds:
          product.category === ProductCategory.SunProtection
            ? [SuggestionEvidenceSourceId.AadSunscreenSelection]
            : productSupportsPigment(product)
              ? [
                  SuggestionEvidenceSourceId.MayoDrySkinCare,
                  SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
                ]
              : [SuggestionEvidenceSourceId.MayoDrySkinCare],
      };
    }),
    applicationPatterns: {
      days: 0,
      daysSinceLastApplication: null,
      conservativeRestart: false,
      skippedByCategory: input.skippedByCategory ?? {},
      substitutedByCategory: {},
      addedOffShelfCount: 0,
      editedLogCount: 0,
      adherenceByCategory: {},
    },
    safetyConstraints: input.safetyConstraints ?? [],
    governance: {
      safetyPolicyVersion: 'quick-evaluation-2026-05-29',
      safetyPolicyReviewedAt: '2026-05-29',
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
    evidenceSources: getSuggestionEvidenceSources(evidenceSourceIds),
    skippedCandidates: [],
    appliedProductHistory: input.appliedProductHistory,
    routineMemory: {
      recordsConsidered: (input.recentApplications ?? []).length,
      previousSuggestionCount: 0,
      sameDaypartSuggestionCount: 0,
      recentSameDaypartFingerprints: [],
      recentSameDateSuggestions: [],
      recentlySuggestedProductIds: [],
      exactRepeatCountByFingerprint: {},
      skippedProducts:
        input.skippedByCategory && input.product
          ? { [input.product.id]: 1 }
          : {},
      substitutedProducts: {},
      adheredProducts: {},
      editedLogCount: 0,
      offShelfUseCount: 0,
    },
  };
}

function quickEvaluationEvidenceSourceIds(
  profile: SkinProfile,
  products: readonly InventoryProduct[],
): SuggestionEvidenceSourceId[] {
  const activeTagSourceIds = products.flatMap((product) =>
    sourceIdsForActiveTags(product.identity?.benefits ?? []),
  );
  const hasPhotosensitizingActive = products.some((product) =>
    (product.identity?.benefits ?? []).some((tag) =>
      ['retinoid', 'aha', 'bha'].includes(tag),
    ),
  );
  const sourceIds: SuggestionEvidenceSourceId[] = [
    SuggestionEvidenceSourceId.MayoDrySkinCare,
    ...activeTagSourceIds,
  ];
  if (
    products.some(
      (product) => product.category === ProductCategory.SunProtection,
    )
  ) {
    sourceIds.push(SuggestionEvidenceSourceId.AadSunscreenSelection);
  }
  if (hasPhotosensitizingActive) {
    sourceIds.push(
      SuggestionEvidenceSourceId.AadSunscreenSelection,
      SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
    );
  }
  if (profileOrProductsSupportPigment(profile, products)) {
    sourceIds.push(
      SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
    );
  }
  return mergeEvidenceSourceIds(sourceIds);
}

function profileOrProductsSupportPigment(
  profile: SkinProfile,
  products: readonly InventoryProduct[],
): boolean {
  const text = [
    profile.primary_goal ?? '',
    ...(profile.current_concerns ?? []),
    ...products.flatMap((product) => [
      product.identity?.description ?? '',
      ...(product.identity?.benefits ?? []),
      ...(product.identity?.suitedFor ?? []),
    ]),
  ].join(' ');
  return /dark marks|post-acne|uneven tone|pigment|hyperpigmentation|pih/i.test(
    text,
  );
}

function productSupportsPigment(product: InventoryProduct): boolean {
  const text = [
    product.identity?.description ?? '',
    ...(product.identity?.benefits ?? []),
    ...(product.identity?.suitedFor ?? []),
  ].join(' ');
  return /dark marks|post-acne|uneven tone|pigment|hyperpigmentation|pih/i.test(
    text,
  );
}

function defaultSuitabilityReasons(product: InventoryProduct): string[] {
  if (product.category === ProductCategory.SunProtection) {
    return ['Good daytime sunscreen, but not needed indoors tonight.'];
  }
  return [
    `${product.name} is an owned active shelf product compatible with this quick request.`,
  ];
}

function applicationLog(input: {
  targetDate: string;
  daypart: SuggestionDaypart;
  items: ApplicationLogItem[];
}): ApplicationLog {
  return {
    id: `quick-log-${input.targetDate}`,
    target_date: input.targetDate,
    daypart: input.daypart,
    target_time: '12:00',
    has_been_edited: false,
    general_notes: null,
    updated_at: new Date(`${input.targetDate}T12:05:00.000Z`),
    items: input.items,
  } as unknown as ApplicationLog;
}

function applicationItem(input: {
  product: InventoryProduct;
  status: ApplicationItemStatus;
  notes: string | null;
}): ApplicationLogItem {
  return {
    id: `quick-item-${input.product.id}`,
    status: input.status,
    item_source: ApplicationItemSource.Recommended,
    inventory_product_id: input.product.id,
    product_brand_snapshot: input.product.brand,
    product_name_snapshot: input.product.name,
    step_label: input.product.category,
    notes: input.notes,
    recommended_snapshot: {
      product_id: input.product.id,
      brand: input.product.brand,
      name: input.product.name,
      step_label: input.product.category,
    },
  } as unknown as ApplicationLogItem;
}
