import { ProductCategory } from '../../shelf/shelf.types';
import {
  AnalysisConfidence,
  type ProductForAnalysis,
} from '../ingredients.types';
import {
  ProductCompareGoal,
  ProductCompareItemKind,
  ProductCompareOutcome,
  ProductCompareReasonCode,
} from '../product-compare.types';
import {
  ProductCheckContextSignal,
  ProductCheckPersonalizationLevel,
  ProductCheckSource,
  type ProductCheckProductInput,
} from '../product-check.types';

export type ProductCompareCaseItem =
  | {
      kind: ProductCompareItemKind.CheckedProduct;
      product: ProductCheckProductInput;
    }
  | {
      kind: ProductCompareItemKind.ShelfProduct;
      productId: string;
    };

export type ProductCompareExpected = {
  outcomes: ProductCompareOutcome[];
  winnerItemIds?: Array<string | null>;
  confidence?: AnalysisConfidence[];
  contextLevel?: ProductCheckPersonalizationLevel;
  contextSignals?: ProductCheckContextSignal[];
  reasonCodes?: ProductCompareReasonCode[];
  forbiddenReasonCodes?: ProductCompareReasonCode[];
  requireAiReviewed?: boolean;
  requireSummaryIncludes?: string[];
  requireSummaryExcludes?: string[];
  requireNoBuyingLanguage?: boolean;
  requireNoDuplicateReasonKeys?: boolean;
};

export type ProductCompareRealLifeCase = {
  id: string;
  title: string;
  goal: ProductCompareGoal;
  anchor: ProductCompareCaseItem;
  candidates: ProductCompareCaseItem[];
  skinProfile?: {
    skinType?: string;
    sensitivityLevel?: string;
    reactionTriggers?: string[];
  };
  shelfProducts?: ProductForAnalysis[];
  journalReactionCount?: number;
  suggestionReactionCount?: number;
  expected: ProductCompareExpected;
};

const SAFE_MOISTURIZER_INCI = [
  'Glycerin',
  'Ceramide NP',
  'Panthenol',
  'Dimethicone',
  'Squalane',
];

const SAFE_SERUM_INCI = [
  'Niacinamide',
  'Panthenol',
  'Allantoin',
  'Centella Asiatica',
  'Green Tea Extract',
];

const GENTLE_BRIGHTENING_INCI = [
  'Niacinamide',
  'Azelaic Acid',
  'Panthenol',
  'Allantoin',
  'Green Tea Extract',
];

const SPF_INCI = [
  'Zinc Oxide',
  'Dimethicone',
  'Squalane',
  'Panthenol',
  'Tocopherol',
];

const RETINOID_AHA_INCI = [
  'Retinol',
  'Glycolic Acid',
  'Glycerin',
  'Panthenol',
  'Ceramide NP',
];

const RETINOID_INCI = [
  'Retinol',
  'Glycerin',
  'Panthenol',
  'Ceramide NP',
  'Dimethicone',
];

const AHA_INCI = [
  'Glycolic Acid',
  'Lactic Acid',
  'Glycerin',
  'Panthenol',
  'Allantoin',
];

export const PRODUCT_COMPARE_REAL_LIFE_CASES: readonly ProductCompareRealLifeCase[] =
  [
    {
      id: 'new_product_duplicate_owned_replacement_only',
      title:
        'Before-buying compare should flag a near-duplicate as replacement-only',
      goal: ProductCompareGoal.NewProductDecision,
      anchor: {
        kind: ProductCompareItemKind.CheckedProduct,
        product: checkedProduct({
          brand: 'New Lab',
          name: 'Niacinamide Barrier Serum',
          category: ProductCategory.Serum,
          inciIngredients: SAFE_SERUM_INCI,
        }),
      },
      candidates: [shelfCandidate('owned-niacinamide-serum')],
      skinProfile: baselineProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-niacinamide-serum',
          'Current Niacinamide Serum',
          ProductCategory.Serum,
          SAFE_SERUM_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.NoClearWinner],
        winnerItemIds: [null],
        contextLevel: ProductCheckPersonalizationLevel.Personalized,
        contextSignals: [ProductCheckContextSignal.SkinProfile],
        reasonCodes: [
          ProductCompareReasonCode.AlreadyOwned,
          ProductCompareReasonCode.ReplacementOnly,
        ],
        requireAiReviewed: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'new_product_clear_safer_duplicate_can_replace',
      title:
        'Before-buying compare should choose a clearly safer duplicate only as replacement',
      goal: ProductCompareGoal.NewProductDecision,
      anchor: {
        kind: ProductCompareItemKind.CheckedProduct,
        product: checkedProduct({
          brand: 'Gentle Lab',
          name: 'Gentle Barrier Lotion',
          category: ProductCategory.Moisturizer,
          inciIngredients: SAFE_MOISTURIZER_INCI,
        }),
      },
      candidates: [shelfCandidate('owned-active-lotion')],
      skinProfile: {
        skinType: 'sensitive',
        sensitivityLevel: 'high',
        reactionTriggers: ['Retinol'],
      },
      shelfProducts: [
        shelfProduct(
          'owned-active-lotion',
          'Active Night Lotion',
          ProductCategory.Moisturizer,
          ['Retinol', 'Glycerin', 'Ceramide NP', 'Panthenol'],
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.ChooseAnchor],
        winnerItemIds: ['anchor'],
        confidence: [AnalysisConfidence.High, AnalysisConfidence.Medium],
        reasonCodes: [
          ProductCompareReasonCode.BetterFit,
          ProductCompareReasonCode.ReplacementOnly,
        ],
        requireAiReviewed: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'new_product_unsafe_choose_owned_alternative',
      title:
        'Before-buying compare should tell the user to keep the safer owned product',
      goal: ProductCompareGoal.NewProductDecision,
      anchor: {
        kind: ProductCompareItemKind.CheckedProduct,
        product: checkedProduct({
          brand: 'Strong Lab',
          name: 'Retinol Glycolic Peel',
          category: ProductCategory.Serum,
          inciIngredients: RETINOID_AHA_INCI,
        }),
      },
      candidates: [shelfCandidate('owned-gentle-serum')],
      skinProfile: sensitiveProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-gentle-serum',
          'Gentle Barrier Serum',
          ProductCategory.Serum,
          SAFE_SERUM_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.ChooseCandidate],
        winnerItemIds: ['candidate-1'],
        reasonCodes: [
          ProductCompareReasonCode.BetterFit,
          ProductCompareReasonCode.LowerConflict,
        ],
        requireAiReviewed: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'new_product_different_role_safe_addition',
      title:
        'Before-buying compare should allow a safe product that fills a routine gap',
      goal: ProductCompareGoal.NewProductDecision,
      anchor: {
        kind: ProductCompareItemKind.CheckedProduct,
        product: checkedProduct({
          brand: 'Bright Lab',
          name: 'Brightening Serum',
          category: ProductCategory.Serum,
          inciIngredients: GENTLE_BRIGHTENING_INCI,
        }),
      },
      candidates: [shelfCandidate('owned-moisturizer')],
      skinProfile: baselineProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-moisturizer',
          'Daily Barrier Moisturizer',
          ProductCategory.Moisturizer,
          SAFE_MOISTURIZER_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.ChooseAnchor],
        winnerItemIds: ['anchor'],
        reasonCodes: [
          ProductCompareReasonCode.FillsRoutineGap,
          ProductCompareReasonCode.DifferentRoutineRoles,
        ],
        requireAiReviewed: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'new_product_different_role_conflicts_with_owned_product',
      title:
        'Before-buying compare should warn when a new product clashes with an owned product',
      goal: ProductCompareGoal.NewProductDecision,
      anchor: {
        kind: ProductCompareItemKind.CheckedProduct,
        product: checkedProduct({
          brand: 'Acid Lab',
          name: 'AHA Toner',
          category: ProductCategory.Exfoliant,
          inciIngredients: AHA_INCI,
        }),
      },
      candidates: [shelfCandidate('owned-retinol-treatment')],
      skinProfile: baselineProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-retinol-treatment',
          'Retinol Treatment',
          ProductCategory.Treatment,
          RETINOID_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.NoClearWinner],
        winnerItemIds: [null],
        reasonCodes: [
          ProductCompareReasonCode.DifferentRoutineRoles,
          ProductCompareReasonCode.RoutineConflict,
          ProductCompareReasonCode.UseTogetherCarefully,
        ],
        requireAiReviewed: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'new_product_not_enough_data_no_winner',
      title:
        'Before-buying compare should refuse to choose when the checked product cannot be matched',
      goal: ProductCompareGoal.NewProductDecision,
      anchor: {
        kind: ProductCompareItemKind.CheckedProduct,
        product: checkedProduct({
          brand: 'Mystery Lab',
          name: 'Unknown Complex',
          category: ProductCategory.Serum,
          inciIngredients: ['Proprietary Complex'],
        }),
      },
      candidates: [shelfCandidate('owned-gentle-serum')],
      skinProfile: baselineProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-gentle-serum',
          'Gentle Barrier Serum',
          ProductCategory.Serum,
          SAFE_SERUM_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.NotEnoughData],
        winnerItemIds: [null],
        confidence: [AnalysisConfidence.Low],
        reasonCodes: [ProductCompareReasonCode.NotEnoughData],
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'shelf_duplicate_owned_products_no_buying_language',
      title:
        'Shelf compare should explain duplicate owned products without buying language',
      goal: ProductCompareGoal.ShelfRoutineDecision,
      anchor: shelfCandidate('owned-niacinamide-serum'),
      candidates: [shelfCandidate('owned-barrier-serum')],
      skinProfile: baselineProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-niacinamide-serum',
          'Current Niacinamide Serum',
          ProductCategory.Serum,
          SAFE_SERUM_INCI,
        ),
        shelfProduct(
          'owned-barrier-serum',
          'Backup Barrier Serum',
          ProductCategory.Serum,
          SAFE_SERUM_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.NoClearWinner],
        winnerItemIds: [null],
        reasonCodes: [
          ProductCompareReasonCode.AlreadyOwned,
          ProductCompareReasonCode.ReplacementOnly,
        ],
        requireAiReviewed: true,
        requireNoBuyingLanguage: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'shelf_same_role_choose_safer_owned_product',
      title:
        'Shelf compare should choose the stronger owned product when safety clearly differs',
      goal: ProductCompareGoal.ShelfRoutineDecision,
      anchor: shelfCandidate('owned-gentle-serum'),
      candidates: [shelfCandidate('owned-active-serum')],
      skinProfile: sensitiveProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-gentle-serum',
          'Gentle Barrier Serum',
          ProductCategory.Serum,
          SAFE_SERUM_INCI,
        ),
        shelfProduct(
          'owned-active-serum',
          'Retinol Glycolic Serum',
          ProductCategory.Serum,
          RETINOID_AHA_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.ChooseAnchor],
        winnerItemIds: ['anchor'],
        reasonCodes: [
          ProductCompareReasonCode.BetterFit,
          ProductCompareReasonCode.LowerConflict,
        ],
        requireAiReviewed: true,
        requireNoBuyingLanguage: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'shelf_different_roles_can_coexist',
      title:
        'Shelf compare should say different owned products do not need to compete',
      goal: ProductCompareGoal.ShelfRoutineDecision,
      anchor: shelfCandidate('owned-moisturizer'),
      candidates: [shelfCandidate('owned-spf')],
      skinProfile: baselineProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-moisturizer',
          'Daily Barrier Moisturizer',
          ProductCategory.Moisturizer,
          SAFE_MOISTURIZER_INCI,
        ),
        shelfProduct(
          'owned-spf',
          'Mineral SPF',
          ProductCategory.SunProtection,
          SPF_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.NoClearWinner],
        winnerItemIds: [null],
        reasonCodes: [ProductCompareReasonCode.DifferentRoutineRoles],
        forbiddenReasonCodes: [ProductCompareReasonCode.RoutineConflict],
        requireAiReviewed: true,
        requireNoBuyingLanguage: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'shelf_different_roles_use_together_conflict',
      title:
        'Shelf compare should warn when two owned products should not be layered together',
      goal: ProductCompareGoal.ShelfRoutineDecision,
      anchor: shelfCandidate('owned-retinol-treatment'),
      candidates: [shelfCandidate('owned-aha-toner')],
      skinProfile: baselineProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-retinol-treatment',
          'Retinol Treatment',
          ProductCategory.Treatment,
          RETINOID_INCI,
        ),
        shelfProduct(
          'owned-aha-toner',
          'AHA Toner',
          ProductCategory.Exfoliant,
          AHA_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.NoClearWinner],
        winnerItemIds: [null],
        reasonCodes: [
          ProductCompareReasonCode.DifferentRoutineRoles,
          ProductCompareReasonCode.RoutineConflict,
          ProductCompareReasonCode.UseTogetherCarefully,
        ],
        requireAiReviewed: true,
        requireNoBuyingLanguage: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'shelf_reaction_history_choose_other_owned_product',
      title:
        'Shelf compare should prefer the owned product that avoids known reaction triggers',
      goal: ProductCompareGoal.ShelfRoutineDecision,
      anchor: shelfCandidate('owned-niacinamide-serum'),
      candidates: [shelfCandidate('owned-calm-serum')],
      skinProfile: {
        skinType: 'combination',
        sensitivityLevel: 'medium',
        reactionTriggers: ['Niacinamide'],
      },
      shelfProducts: [
        shelfProduct(
          'owned-niacinamide-serum',
          'Niacinamide Serum',
          ProductCategory.Serum,
          SAFE_SERUM_INCI,
        ),
        shelfProduct(
          'owned-calm-serum',
          'Calming Serum',
          ProductCategory.Serum,
          ['Panthenol', 'Allantoin', 'Centella Asiatica', 'Green Tea Extract'],
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.ChooseCandidate],
        winnerItemIds: ['candidate-1'],
        contextSignals: [
          ProductCheckContextSignal.SkinProfile,
          ProductCheckContextSignal.ReactionHistory,
        ],
        reasonCodes: [
          ProductCompareReasonCode.BetterFit,
          ProductCompareReasonCode.ReactionRisk,
        ],
        requireAiReviewed: true,
        requireNoBuyingLanguage: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'shelf_not_enough_data_no_winner',
      title:
        'Shelf compare should refuse to advise when an owned product lacks usable ingredient data',
      goal: ProductCompareGoal.ShelfRoutineDecision,
      anchor: shelfCandidate('owned-mystery-product'),
      candidates: [shelfCandidate('owned-gentle-serum')],
      skinProfile: baselineProfile(),
      shelfProducts: [
        shelfProduct(
          'owned-mystery-product',
          'Mystery Serum',
          ProductCategory.Serum,
          ['Proprietary Complex'],
        ),
        shelfProduct(
          'owned-gentle-serum',
          'Gentle Barrier Serum',
          ProductCategory.Serum,
          SAFE_SERUM_INCI,
        ),
      ],
      expected: {
        outcomes: [ProductCompareOutcome.NotEnoughData],
        winnerItemIds: [null],
        confidence: [AnalysisConfidence.Low],
        reasonCodes: [ProductCompareReasonCode.NotEnoughData],
        requireNoBuyingLanguage: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
  ];

function checkedProduct(
  input: Omit<ProductCheckProductInput, 'source'>,
): ProductCheckProductInput {
  return {
    source: ProductCheckSource.IngredientPaste,
    ...input,
  };
}

function shelfCandidate(productId: string): ProductCompareCaseItem {
  return {
    kind: ProductCompareItemKind.ShelfProduct,
    productId,
  };
}

function shelfProduct(
  id: string,
  name: string,
  category: ProductCategory,
  inciIngredients: string[],
): ProductForAnalysis {
  return {
    id,
    brand: 'Shelf Lab',
    name,
    category,
    inciIngredients,
  };
}

function baselineProfile() {
  return {
    skinType: 'combination',
    sensitivityLevel: 'medium',
  };
}

function sensitiveProfile() {
  return {
    skinType: 'sensitive',
    sensitivityLevel: 'high',
  };
}
