import { ProductCategory } from '../../shelf/shelf.types';
import {
  AnalysisConfidence,
  AnalysisSeverity,
  type ProductForAnalysis,
} from '../ingredients.types';
import {
  ProductCheckContextSignal,
  ProductCheckNextAction,
  ProductCheckPersonalizationLevel,
  ProductCheckPurchaseGuidanceReasonCode,
  ProductCheckReasonCode,
  ProductCheckSource,
  ProductCheckVerdict,
  type ProductCheckProductInput,
} from '../product-check.types';

export type ProductCheckExpected = {
  verdicts: ProductCheckVerdict[];
  forbiddenVerdicts?: ProductCheckVerdict[];
  nextActions?: ProductCheckNextAction[];
  contextLevel?: ProductCheckPersonalizationLevel;
  contextSignals?: ProductCheckContextSignal[];
  reasonCodes?: ProductCheckReasonCode[];
  forbiddenReasonCodes?: ProductCheckReasonCode[];
  purchaseGuidanceReasonCodes?: ProductCheckPurchaseGuidanceReasonCode[];
  activeNames?: string[];
  confidence?: AnalysisConfidence;
  safetyScore?: number | null;
  minSafetyScore?: number;
  maxSafetyScore?: number;
  maxReasonCount?: number;
  shouldConsiderAlternatives?: boolean;
  requireAiReviewed?: boolean;
  requireAiSummary?: boolean;
  requireNoDuplicateReasonKeys?: boolean;
};

export type ProductCheckRealLifeCase = {
  id: string;
  title: string;
  product: ProductCheckProductInput;
  skinProfile?: {
    skinType?: string;
    sensitivityLevel?: string;
    reactionTriggers?: string[];
  };
  shelfProducts?: ProductForAnalysis[];
  journalReactionCount?: number;
  suggestionReactionCount?: number;
  expected: ProductCheckExpected;
};

export type PhotoQuickCheckRealLifeCase = {
  id: string;
  title: string;
  labelLines: string[];
  skinProfile?: ProductCheckRealLifeCase['skinProfile'];
  shelfProducts?: ProductForAnalysis[];
  journalReactionCount?: number;
  suggestionReactionCount?: number;
  expectedExtraction: {
    brandIncludes?: string;
    nameIncludes?: string;
    category?: ProductCategory;
    ingredientNames?: string[];
    minIngredientCount?: number;
  };
  expected: ProductCheckExpected;
};

export type IngredientAnalysisRealLifeCase = {
  id: string;
  title: string;
  products: ProductForAnalysis[];
  focusProductId?: string;
  expected: {
    activeNames?: string[];
    conflictCodes?: string[];
    conflictSeverities?: AnalysisSeverity[];
    minSafetyScore?: number;
    maxSafetyScore?: number;
    confidence?: AnalysisConfidence;
    requireExplanations?: boolean;
  };
};

export const PRODUCT_CHECK_REAL_LIFE_CASES: readonly ProductCheckRealLifeCase[] =
  [
    {
      id: 'cerave_lotion_routine_clash_not_do_not_buy',
      title:
        'Moisturizer with citric acid should not become do-not-buy because shelf has acids',
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'CeraVe',
        name: 'Moisturising Lotion',
        category: ProductCategory.Moisturizer,
        inciIngredients: [
          'Aqua/Water',
          'Glycerin',
          'Caprylic/Capric Triglyceride',
          'Cetearyl Alcohol',
          'Cetyl Alcohol',
          'Dimethicone',
          'Citric Acid',
          'Ceramide NP',
          'Ceramide AP',
          'Phytosphingosine',
          'Cholesterol',
          'Sodium Hyaluronate',
          'Tocopherol',
          'Ceramide EOP',
        ],
      },
      skinProfile: {
        skinType: 'combination',
        sensitivityLevel: 'medium',
      },
      shelfProducts: [
        shelfProduct('azelaic-serum', 'Azelaic Serum', [
          'Aqua',
          'Azelaic Acid',
        ]),
        shelfProduct('bha-toner', 'BHA Toner', ['Aqua', 'Salicylic Acid']),
        shelfProduct('willow-toner', 'Willow Toner', [
          'Aqua',
          'Willow Bark Extract',
        ]),
      ],
      expected: {
        verdicts: [
          ProductCheckVerdict.GoodWithLimits,
          ProductCheckVerdict.UseCarefully,
        ],
        forbiddenVerdicts: [ProductCheckVerdict.AvoidForProfile],
        nextActions: [
          ProductCheckNextAction.ReviewAndPatchTest,
          ProductCheckNextAction.ReviewSmartPicks,
        ],
        contextLevel: ProductCheckPersonalizationLevel.Personalized,
        contextSignals: [
          ProductCheckContextSignal.SkinProfile,
          ProductCheckContextSignal.ActiveShelf,
        ],
        activeNames: ['Glycerin', 'Ceramides', 'Hyaluronic acid'],
        minSafetyScore: 60,
        maxReasonCount: 3,
        requireAiReviewed: true,
        requireNoDuplicateReasonKeys: true,
      },
    },
    {
      id: 'no_profile_gets_ingredient_guide_only',
      title:
        'No personal data should return ingredient education, not reaction certainty',
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'Ritora Lab',
        name: 'Barrier Cream',
        category: ProductCategory.Moisturizer,
        inciIngredients: ['Aqua', 'Glycerin', 'Ceramide NP'],
      },
      expected: {
        verdicts: [ProductCheckVerdict.IngredientsOnly],
        contextLevel: ProductCheckPersonalizationLevel.Educational,
        activeNames: ['Glycerin', 'Ceramides'],
        reasonCodes: [ProductCheckReasonCode.MissingPersonalContext],
        requireAiReviewed: true,
      },
    },
    {
      id: 'internal_retinoid_aha_is_do_not_buy_for_profile',
      title:
        'Product containing retinoid plus AHA should clearly avoid for profile',
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'Actives Co',
        name: 'Retinol Glycolic Peel Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Aqua', 'Retinol', 'Glycolic Acid'],
      },
      skinProfile: {
        skinType: 'sensitive',
        sensitivityLevel: 'high',
      },
      expected: {
        verdicts: [ProductCheckVerdict.AvoidForProfile],
        nextActions: [ProductCheckNextAction.SkipProduct],
        reasonCodes: [ProductCheckReasonCode.HighConflict],
        maxSafetyScore: 75,
        requireAiReviewed: true,
      },
    },
    {
      id: 'routine_retinoid_aha_is_use_carefully_not_avoid',
      title: 'Routine clash should explain spacing rather than block purchase',
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'Retinol Lab',
        name: 'Beginner Retinol Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Aqua', 'Retinol'],
      },
      skinProfile: {
        skinType: 'combination',
        sensitivityLevel: 'medium',
      },
      shelfProducts: [
        shelfProduct('aha-toner', 'Glycolic Toner', ['Aqua', 'Glycolic Acid']),
      ],
      expected: {
        verdicts: [ProductCheckVerdict.UseCarefully],
        forbiddenVerdicts: [ProductCheckVerdict.AvoidForProfile],
        reasonCodes: [ProductCheckReasonCode.HighConflict],
        requireNoDuplicateReasonKeys: true,
        requireAiReviewed: true,
      },
    },
    {
      id: 'reaction_history_trigger_raises_caution',
      title:
        'Known reaction trigger should make a normally useful ingredient cautious',
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'B3 Lab',
        name: 'Niacinamide Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Aqua', 'Niacinamide'],
      },
      skinProfile: {
        skinType: 'combination',
        sensitivityLevel: 'medium',
        reactionTriggers: ['Niacinamide'],
      },
      expected: {
        verdicts: [ProductCheckVerdict.UseCarefully],
        reasonCodes: [ProductCheckReasonCode.ReactionTrigger],
        contextSignals: [
          ProductCheckContextSignal.SkinProfile,
          ProductCheckContextSignal.ReactionHistory,
        ],
        activeNames: ['Niacinamide'],
        requireAiReviewed: true,
      },
    },
    {
      id: 'already_owned_active_flags_wasted_money_risk',
      title:
        'Product that duplicates what the user already owns should flag overlap and alternatives',
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'B3 Lab',
        name: 'Niacinamide Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Aqua', 'Niacinamide', 'Glycerin'],
      },
      skinProfile: {
        skinType: 'combination',
        sensitivityLevel: 'medium',
      },
      shelfProducts: [
        shelfProduct('owned-niacinamide', 'Current Niacinamide Serum', [
          'Aqua',
          'Niacinamide',
          'Glycerin',
        ]),
      ],
      expected: {
        verdicts: [
          ProductCheckVerdict.GoodWithLimits,
          ProductCheckVerdict.UseCarefully,
        ],
        nextActions: [ProductCheckNextAction.ReviewSmartPicks],
        contextSignals: [
          ProductCheckContextSignal.SkinProfile,
          ProductCheckContextSignal.ActiveShelf,
        ],
        reasonCodes: [ProductCheckReasonCode.DuplicateExposure],
        purchaseGuidanceReasonCodes: [
          ProductCheckPurchaseGuidanceReasonCode.DuplicateExposure,
        ],
        shouldConsiderAlternatives: true,
        activeNames: ['Niacinamide', 'Glycerin'],
        requireAiReviewed: true,
        requireAiSummary: true,
      },
    },
    {
      id: 'journal_and_suggestion_reactions_raise_buying_caution',
      title:
        'Recent journal and suggestion reaction signals should make the product cautious',
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'Glow Lab',
        name: 'Brightening Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Aqua', 'Ascorbic Acid', 'Glycerin'],
      },
      skinProfile: {
        skinType: 'combination',
        sensitivityLevel: 'medium',
      },
      journalReactionCount: 2,
      suggestionReactionCount: 1,
      expected: {
        verdicts: [ProductCheckVerdict.UseCarefully],
        contextSignals: [
          ProductCheckContextSignal.SkinProfile,
          ProductCheckContextSignal.SkinJournal,
          ProductCheckContextSignal.SuggestionHistory,
        ],
        reasonCodes: [
          ProductCheckReasonCode.RecentJournalReaction,
          ProductCheckReasonCode.SuggestionHistoryReaction,
        ],
        activeNames: ['Vitamin C', 'Glycerin'],
        requireAiReviewed: true,
        requireAiSummary: true,
      },
    },
    {
      id: 'unmatched_inci_not_enough_data',
      title: 'Unknown ingredient list should not pretend to know reaction risk',
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'Mystery Brand',
        name: 'Mystery Complex',
        category: ProductCategory.Serum,
        inciIngredients: ['Mystery Bioactive Complex'],
      },
      skinProfile: {
        skinType: 'normal',
      },
      expected: {
        verdicts: [ProductCheckVerdict.NotEnoughData],
        confidence: AnalysisConfidence.Low,
        safetyScore: null,
        reasonCodes: [ProductCheckReasonCode.InsufficientIngredients],
      },
    },
  ];

export const PHOTO_QUICK_CHECK_REAL_LIFE_CASES: readonly PhotoQuickCheckRealLifeCase[] =
  [
    {
      id: 'photo_label_extracts_inci_then_checks_product',
      title:
        'Photo label should extract a complete INCI list and feed the same Quick Check verdict',
      labelLines: [
        'Ritora Lab',
        'Barrier Cream',
        'Moisturizer',
        'For dry and sensitive skin',
        'Ingredients: Aqua, Glycerin, Caprylic/Capric Triglyceride,',
        'Cetearyl Alcohol, Ceramide NP, Sodium Hyaluronate, Tocopherol.',
        'Directions: Apply to face and neck morning and evening.',
        'Warnings: For external use only. Avoid direct contact with eyes.',
        'Net contents 50 ml',
      ],
      skinProfile: {
        skinType: 'dry',
        sensitivityLevel: 'medium',
      },
      expectedExtraction: {
        brandIncludes: 'Ritora',
        nameIncludes: 'Barrier Cream',
        category: ProductCategory.Moisturizer,
        ingredientNames: ['Glycerin', 'Ceramide NP', 'Sodium Hyaluronate'],
        minIngredientCount: 6,
      },
      expected: {
        verdicts: [
          ProductCheckVerdict.GoodFit,
          ProductCheckVerdict.GoodWithLimits,
          ProductCheckVerdict.UseCarefully,
        ],
        contextSignals: [ProductCheckContextSignal.SkinProfile],
        activeNames: ['Glycerin', 'Ceramides', 'Hyaluronic acid'],
        requireAiReviewed: true,
        requireAiSummary: true,
      },
    },
  ];

export const INGREDIENT_ANALYSIS_REAL_LIFE_CASES: readonly IngredientAnalysisRealLifeCase[] =
  [
    {
      id: 'barrier_moisturizer_ingredient_meanings',
      title: 'Barrier moisturizer explains useful ingredients clearly',
      products: [
        product('barrier-cream', 'Ritora Lab', 'Barrier Cream', [
          'Aqua',
          'Glycerin',
          'Ceramide NP',
          'Sodium Hyaluronate',
        ]),
      ],
      focusProductId: 'barrier-cream',
      expected: {
        activeNames: ['Glycerin', 'Ceramides', 'Hyaluronic acid'],
        confidence: AnalysisConfidence.High,
      },
    },
    {
      id: 'retinoid_aha_conflict_has_ai_explanation',
      title: 'Retinoid plus AHA conflict returns a clear AI explanation',
      products: [
        product('retinol', 'Actives Co', 'Retinol Serum', ['Retinol']),
        product('aha', 'Actives Co', 'Glycolic Toner', ['Glycolic Acid']),
      ],
      expected: {
        conflictCodes: ['RETINOID_AHA'],
        conflictSeverities: [AnalysisSeverity.High],
        maxSafetyScore: 75,
        requireExplanations: true,
      },
    },
  ];

function product(
  id: string,
  brand: string,
  name: string,
  inciIngredients: string[],
): ProductForAnalysis {
  return {
    id,
    brand,
    name,
    category: ProductCategory.Serum,
    inciIngredients,
  };
}

function shelfProduct(
  id: string,
  name: string,
  inciIngredients: string[],
): ProductForAnalysis {
  return {
    id,
    brand: 'Shelf Lab',
    name,
    category: ProductCategory.Serum,
    inciIngredients,
  };
}
