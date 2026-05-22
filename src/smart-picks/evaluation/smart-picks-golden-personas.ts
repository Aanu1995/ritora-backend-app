import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import {
  SmartPicksBudgetTier,
  SmartPicksCoverageRole,
  SmartPicksGapKind,
  SmartPicksMode,
  SmartPicksProductPerformanceSignal,
} from '../smart-picks.types';

type GoldenCoverageSlot = {
  role: string;
  state: string;
  filledByProductId: string | null;
  goalRelevance: string;
};

type GoldenPlanGap = {
  ingredientOrCategory: string;
  priority: 'priority' | 'consider';
  reason: string;
  shortReason: string | null;
  goalAlignment: string | null;
  sourceIds: readonly SuggestionEvidenceSourceId[];
  gapKind: SmartPicksGapKind;
  replacementForProductId?: string | null;
};

type GoldenPlanResponse = {
  coverage: { slots: readonly GoldenCoverageSlot[] };
  gaps: readonly GoldenPlanGap[];
};

type GoldenProductPick = {
  normalizedKey: string;
  brand: string;
  productName: string;
  budgetTier: SmartPicksBudgetTier | null;
  recommendationRankReason: string;
  sellerNames: readonly string[];
  reasoningChips: readonly { tone: string; text: string; icon: string }[];
  reasoningFacts: readonly { label: string; value: string }[];
  ruledOut: readonly { brand: string; productName: string; reason: string }[];
  alternatives: readonly GoldenProductPick[];
  sourceIds: readonly SuggestionEvidenceSourceId[];
};

type GoldenProductResponse = {
  gaps: readonly GoldenProductPick[];
};

export type GoldenSmartPicksProduct = {
  id: string;
  brand: string;
  name: string;
  category: ProductCategory;
  status: ShelfStatus;
  ingredients: readonly string[];
  benefits: readonly string[];
};

export type GoldenSmartPicksPerformance = {
  productId: string;
  brand: string;
  productName: string;
  category: ProductCategory;
  usageDaysLast30: number;
  usageDaysLast90: number;
  photoCheckpoints: number;
  goalTrend: SmartPicksProductPerformanceSignal;
  replacementCandidate: boolean;
  replacementReason: string | null;
};

export type GoldenSmartPicksPersona = {
  id: string;
  mode: SmartPicksMode;
  countryCode: string;
  city: string;
  budgetTier: SmartPicksBudgetTier;
  skinType: string;
  skinTone: string;
  ethnicity: string;
  primaryGoal: string;
  currentConcerns: readonly string[];
  pregnancyStatus: string | null;
  ingredientDislikes: readonly string[];
  reactionTriggers: readonly string[];
  activeTolerances: Record<string, { tolerance: string }>;
  activeProducts: readonly GoldenSmartPicksProduct[];
  allProducts: readonly GoldenSmartPicksProduct[];
  productPerformance: readonly GoldenSmartPicksPerformance[];
  aiPlanResponse: GoldenPlanResponse;
  productPickResponse: GoldenProductResponse | null;
  expected: {
    coverageRoles: readonly SmartPicksCoverageRole[];
    priorityGapKeys: readonly string[];
    considerGapKeys: readonly string[];
    minimumConsiderGapCount?: number;
    blockedSafetyGapCount: number;
    blockedPregnancySafetyGapCount: number;
    blockedReplacementEvidenceGapCount: number;
    acceptedProductPickCount: number | null;
  };
  manualReviewChecklist: readonly string[];
};

export const SMART_PICKS_GOLDEN_PERSONAS = [
  {
    id: 'starter_deep_skin_premium_dark_marks_canada',
    mode: 'starter',
    countryCode: 'CA',
    city: 'Toronto',
    budgetTier: 'premium',
    skinType: 'combination',
    skinTone: 'deep',
    ethnicity: 'Black Canadian',
    primaryGoal: 'fade post-breakout dark marks',
    currentConcerns: ['dark marks', 'uneven tone'],
    pregnancyStatus: null,
    ingredientDislikes: [],
    reactionTriggers: [],
    activeTolerances: {},
    activeProducts: [],
    allProducts: [],
    productPerformance: [],
    aiPlanResponse: {
      coverage: {
        slots: [
          missingPriority('cleanse'),
          missingPriority('moisturise'),
          missingPriority('spf'),
          missingPriority('dark-spot-treatment'),
          missing('antioxidant', 'supportive'),
          missing('exfoliation-mask', 'optional'),
        ],
      },
      gaps: [
        planGap(
          'Gentle low-stripping cleanser',
          'priority',
          'A clean base lowers irritation risk before pigment-focused products.',
          'Start with a low-stripping cleanse step.',
          'basic routine support',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Barrier-support moisturizer',
          'priority',
          'Barrier support helps the routine tolerate pigment-focused actives.',
          'Support the barrier before adding stronger actives.',
          'dark-mark routine tolerance',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Broad-spectrum sunscreen SPF 50 with white-cast checked finish',
          'priority',
          'Daily sunscreen is essential because UV exposure keeps many dark marks visible for longer.',
          'Protect against marks getting darker.',
          'PIH prevention',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.AadSunscreenSelection],
        ),
        planGap(
          'Azelaic acid or tranexamic acid dark-mark serum',
          'priority',
          'The stated goal needs a targeted pigment-support lane, not only hydration.',
          'Add one targeted pigment-support lane.',
          'post-breakout mark support',
          SmartPicksGapKind.GoalSupport,
          [
            SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            SuggestionEvidenceSourceId.AadMelasmaTreatment,
          ],
        ),
        planGap(
          'Vitamin C antioxidant serum',
          'consider',
          'An antioxidant can support tone goals when the essentials are tolerated.',
          'Optional antioxidant support.',
          'tone support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation],
        ),
        planGap(
          'Gentle pigment-support mask or peel',
          'consider',
          'A once-weekly gentle support product can help when the user wants a more complete plan.',
          'Optional weekly support.',
          'texture and tone support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
        ),
      ],
    },
    productPickResponse: {
      gaps: [
        productPick(
          'gentle-low-stripping-cleanser',
          'KraveBeauty',
          'Matcha Hemp Hydrating Cleanser',
          'premium',
          'A gentle cleanser fit for starting pigment-support routines without over-stripping.',
        ),
        productPick(
          'barrier-support-moisturizer',
          'La Roche-Posay',
          'Toleriane Sensitive Riche',
          'premium',
          'A barrier-support option that keeps the routine tolerable while actives are introduced.',
        ),
        productPick(
          'broad-spectrum-sunscreen-spf-50-with-white-cast-checked-finish',
          'Beauty of Joseon',
          'Relief Sun Rice + Probiotics SPF 50+',
          'premium',
          'A cosmetically elegant sunscreen pick where finish and daily-use comfort matter.',
        ),
        productPick(
          'azelaic-acid-or-tranexamic-acid-dark-mark-serum',
          'Naturium',
          'Multi-Bright Tranexamic Acid Treatment 5%',
          'premium',
          'A targeted pigment-support serum that fits the stated dark-mark goal.',
        ),
        productPick(
          'vitamin-c-antioxidant-serum',
          'Geek & Gorgeous',
          'C-Glow 15% Vitamin C Serum',
          'premium',
          'A focused antioxidant option for a user who wants a more complete tone plan.',
        ),
        productPick(
          'gentle-pigment-support-mask-or-peel',
          "Paula's Choice",
          '25% AHA + 2% BHA Exfoliant Peel',
          'premium',
          'A once-weekly support option that should stay secondary to sunscreen and pigment serum.',
        ),
      ],
    },
    expected: {
      coverageRoles: [
        'cleanse',
        'moisturise',
        'spf',
        'dark-spot-treatment',
        'antioxidant',
      ],
      priorityGapKeys: [
        'gentle-low-stripping-cleanser',
        'barrier-support-moisturizer',
        'broad-spectrum-sunscreen-spf-50-with-white-cast-checked-finish',
        'azelaic-acid-or-tranexamic-acid-dark-mark-serum',
      ],
      considerGapKeys: ['vitamin-c-antioxidant-serum'],
      minimumConsiderGapCount: 2,
      blockedSafetyGapCount: 0,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: 6,
    },
    manualReviewChecklist: [
      'Does the plan include the core starter steps before optional extras?',
      'Does the pigment lane go beyond generic glow or hydration wording?',
      'Does sunscreen finish matter for deeper skin without making ethnicity claims?',
      'Are optional premium-support products clearly secondary to essentials?',
    ],
  },
  {
    id: 'refine_full_shelf_premium_tone_australia_optional_support',
    mode: 'refine',
    countryCode: 'AU',
    city: 'Melbourne',
    budgetTier: 'premium',
    skinType: 'normal',
    skinTone: 'medium',
    ethnicity: 'South Asian Australian',
    primaryGoal: 'keep dark marks fading while avoiding irritation',
    currentConcerns: ['dark marks', 'texture'],
    pregnancyStatus: null,
    ingredientDislikes: [],
    reactionTriggers: [],
    activeTolerances: {},
    activeProducts: [
      shelfProduct(
        'cleanser-au',
        'CeraVe',
        'Hydrating Cleanser',
        ProductCategory.Cleanser,
        ['glycerin', 'ceramide np'],
      ),
      shelfProduct(
        'moisturizer-au',
        'La Roche-Posay',
        'Toleriane Dermallergo Cream',
        ProductCategory.Moisturizer,
        ['glycerin', 'squalane'],
      ),
      shelfProduct(
        'spf-au',
        'Ultra Violette',
        'Supreme Screen SPF 50+',
        ProductCategory.SunProtection,
        ['uv filters'],
      ),
      shelfProduct(
        'serum-au',
        'The Ordinary',
        'Azelaic Acid Suspension 10%',
        ProductCategory.Treatment,
        ['azelaic acid'],
      ),
    ],
    allProducts: [],
    productPerformance: [],
    aiPlanResponse: {
      coverage: {
        slots: [
          filled('cleanse', 'cleanser-au'),
          filled('moisturise', 'moisturizer-au'),
          filled('spf', 'spf-au'),
          filled('dark-spot-treatment', 'serum-au'),
          missing('antioxidant', 'supportive'),
          missing('exfoliation-mask', 'optional'),
        ],
      },
      gaps: [
        planGap(
          'Vitamin C antioxidant serum',
          'consider',
          'The shelf already has the main pigment lane, so antioxidant support is optional rather than urgent.',
          'Optional antioxidant support.',
          'tone maintenance',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation],
        ),
        planGap(
          'Gentle resurfacing mask',
          'consider',
          'A low-frequency support product may help texture only if the current routine stays calm.',
          'Optional texture support.',
          'texture support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
        ),
      ],
    },
    productPickResponse: null,
    expected: {
      coverageRoles: [
        'cleanse',
        'moisturise',
        'spf',
        'dark-spot-treatment',
        'antioxidant',
        'exfoliation-mask',
      ],
      priorityGapKeys: [],
      considerGapKeys: [
        'vitamin-c-antioxidant-serum',
        'gentle-resurfacing-mask',
      ],
      blockedSafetyGapCount: 0,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: null,
    },
    manualReviewChecklist: [
      'Does the output avoid inventing urgent gaps when core products are present?',
      'Are optional products still suggested when they could help the goal?',
      'Does the plan respect the premium budget without talking about budget in the reason?',
      'Does the coverage meter match the tone goal instead of a generic eight-slot routine?',
    ],
  },
  {
    id: 'starter_sensitive_hydration_sweden_safety_block',
    mode: 'starter',
    countryCode: 'SE',
    city: 'Stockholm',
    budgetTier: 'drugstore',
    skinType: 'dry sensitive',
    skinTone: 'fair',
    ethnicity: 'Swedish',
    primaryGoal: 'reduce tightness and flaky dry patches',
    currentConcerns: ['dryness', 'sensitivity'],
    pregnancyStatus: null,
    ingredientDislikes: ['fragrance'],
    reactionTriggers: [],
    activeTolerances: {},
    activeProducts: [],
    allProducts: [],
    productPerformance: [],
    aiPlanResponse: {
      coverage: {
        slots: [
          missingPriority('cleanse'),
          missingPriority('moisturise'),
          missingPriority('spf'),
          missing('hydrate', 'supportive'),
        ],
      },
      gaps: [
        planGap(
          'Low-stripping gentle cleanser',
          'priority',
          'Sensitive dry skin needs a low-stripping cleanse step.',
          'Start with a gentle cleanser.',
          'dryness support',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Bland barrier moisturizer',
          'priority',
          'A moisturizer is the main support for tightness and dry patches.',
          'Add barrier support.',
          'dryness support',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Sensitive-skin sunscreen',
          'priority',
          'Daily sunscreen still matters, but the pick should suit reactive skin.',
          'Choose a sensitive-skin sunscreen.',
          'daily protection',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.AadSunscreenSelection],
        ),
        planGap(
          'Fragranced glow toner',
          'consider',
          'This is blocked because the user dislikes fragrance.',
          'Blocked optional toner.',
          'glow support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
      ],
    },
    productPickResponse: null,
    expected: {
      coverageRoles: ['cleanse', 'moisturise', 'spf', 'hydrate'],
      priorityGapKeys: [
        'low-stripping-gentle-cleanser',
        'bland-barrier-moisturizer',
        'sensitive-skin-sunscreen',
      ],
      considerGapKeys: [],
      blockedSafetyGapCount: 1,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: null,
    },
    manualReviewChecklist: [
      'Does the starter kit stay simple for a dry sensitive profile?',
      'Are fragrance-related suggestions blocked rather than softened?',
      'Does the plan avoid exfoliation and retinoids unless clearly justified?',
      'Are sunscreen and moisturizer still present despite the hydration goal?',
    ],
  },
  {
    id: 'refine_pregnancy_fine_lines_uk_retinoid_block',
    mode: 'refine',
    countryCode: 'GB',
    city: 'London',
    budgetTier: 'mid',
    skinType: 'normal dry',
    skinTone: 'light medium',
    ethnicity: 'British Nigerian',
    primaryGoal: 'support fine lines while pregnant',
    currentConcerns: ['fine lines', 'dryness'],
    pregnancyStatus: 'pregnant',
    ingredientDislikes: [],
    reactionTriggers: [],
    activeTolerances: {},
    activeProducts: [
      shelfProduct(
        'cleanser-uk',
        'Simple',
        'Kind to Skin Cleanser',
        ProductCategory.Cleanser,
        ['glycerin'],
      ),
      shelfProduct(
        'moisturizer-uk',
        'CeraVe',
        'Moisturising Cream',
        ProductCategory.Moisturizer,
        ['ceramide np', 'glycerin'],
      ),
      shelfProduct(
        'spf-uk',
        'Altruist',
        'Dermatologist Sunscreen SPF 50',
        ProductCategory.SunProtection,
        ['uv filters'],
      ),
    ],
    allProducts: [],
    productPerformance: [],
    aiPlanResponse: {
      coverage: {
        slots: [
          filled('cleanse', 'cleanser-uk'),
          filled('moisturise', 'moisturizer-uk'),
          filled('spf', 'spf-uk'),
          missing('peptide', 'supportive'),
          missing('retinoid', 'optional'),
        ],
      },
      gaps: [
        planGap(
          'Retinoid night treatment',
          'priority',
          'Retinoids are blocked by pregnancy safety context.',
          'Blocked retinoid.',
          'fine line support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.AadRetinoidRetinol],
        ),
        planGap(
          'Peptide or barrier-support serum',
          'consider',
          'A pregnancy-compatible support lane is a safer optional path for this goal.',
          'Optional pregnancy-compatible support.',
          'fine line support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
      ],
    },
    productPickResponse: null,
    expected: {
      coverageRoles: ['cleanse', 'moisturise', 'spf', 'peptide', 'retinoid'],
      priorityGapKeys: [],
      considerGapKeys: ['peptide-or-barrier-support-serum'],
      blockedSafetyGapCount: 1,
      blockedPregnancySafetyGapCount: 1,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: null,
    },
    manualReviewChecklist: [
      'Is the retinoid blocked because pregnancy context overrides goal speed?',
      'Does the plan offer a safer optional lane instead of leaving the user with nothing?',
      'Does it avoid medical advice about pregnancy beyond cautious product filtering?',
      'Are filled coverage slots tied only to active shelf products?',
    ],
  },
  {
    id: 'refine_replacement_history_not_improving_us',
    mode: 'refine',
    countryCode: 'US',
    city: 'Atlanta',
    budgetTier: 'luxury',
    skinType: 'oily combination',
    skinTone: 'deep',
    ethnicity: 'Black American',
    primaryGoal: 'fade stubborn marks without irritation',
    currentConcerns: ['dark marks', 'uneven tone'],
    pregnancyStatus: null,
    ingredientDislikes: [],
    reactionTriggers: [],
    activeTolerances: {},
    activeProducts: [
      shelfProduct(
        'current-brightening-serum',
        'Current Brand',
        'Brightening Serum',
        ProductCategory.Serum,
        ['niacinamide'],
      ),
      shelfProduct(
        'spf-us',
        'Black Girl Sunscreen',
        'Make It Matte SPF 45',
        ProductCategory.SunProtection,
        ['uv filters'],
      ),
    ],
    allProducts: [],
    productPerformance: [
      {
        productId: 'current-brightening-serum',
        brand: 'Current Brand',
        productName: 'Brightening Serum',
        category: ProductCategory.Serum,
        usageDaysLast30: 24,
        usageDaysLast90: 68,
        photoCheckpoints: 4,
        goalTrend: SmartPicksProductPerformanceSignal.NotImproving,
        replacementCandidate: true,
        replacementReason:
          '68 logged use days and four photo checkpoints still show little tone change.',
      },
    ],
    aiPlanResponse: {
      coverage: {
        slots: [
          filled('spf', 'spf-us'),
          filled('dark-spot-treatment', 'current-brightening-serum'),
          missing('goal-primary', 'essential'),
        ],
      },
      gaps: [
        planGap(
          'Replacement pigment serum with tranexamic acid or azelaic acid',
          'priority',
          'Use logs and photo checkpoints show the current serum has not clearly moved the goal.',
          'Replace the underperforming pigment serum.',
          'replacement for slow progress',
          SmartPicksGapKind.Replacement,
          [
            SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
            SuggestionEvidenceSourceId.AadMelasmaTreatment,
          ],
          'current-brightening-serum',
        ),
      ],
    },
    productPickResponse: {
      gaps: [
        productPick(
          'replacement-pigment-serum-with-tranexamic-acid-or-azelaic-acid',
          'SkinCeuticals',
          'Discoloration Defense',
          'luxury',
          'A stronger pigment-support replacement is justified by consistent use and slow photo trend movement.',
        ),
      ],
    },
    expected: {
      coverageRoles: ['spf', 'dark-spot-treatment', 'goal-primary'],
      priorityGapKeys: [
        'replacement-pigment-serum-with-tranexamic-acid-or-azelaic-acid',
      ],
      considerGapKeys: [],
      blockedSafetyGapCount: 0,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: 1,
    },
    manualReviewChecklist: [
      'Is replacement justified with both usage history and photo checkpoints?',
      'Does the reason clearly state why this is a replacement, not a shopping nudge?',
      'Does the product tier match a user who selected a high-spend budget?',
      'Does the output avoid saying photos clinically prove failure?',
    ],
  },
  {
    id: 'refine_full_shelf_no_buy_sweden',
    mode: 'refine',
    countryCode: 'SE',
    city: 'Gothenburg',
    budgetTier: 'mid',
    skinType: 'combination',
    skinTone: 'medium deep',
    ethnicity: 'Somali Swedish',
    primaryGoal: 'maintain a calm clear routine',
    currentConcerns: ['occasional congestion'],
    pregnancyStatus: null,
    ingredientDislikes: [],
    reactionTriggers: [],
    activeTolerances: {},
    activeProducts: [
      shelfProduct(
        'cleanser-se',
        'CeraVe',
        'SA Smoothing Cleanser',
        ProductCategory.Cleanser,
        ['salicylic acid', 'glycerin'],
      ),
      shelfProduct(
        'moisturizer-se',
        'CeraVe',
        'Moisturising Lotion',
        ProductCategory.Moisturizer,
        ['ceramide np', 'glycerin'],
      ),
      shelfProduct(
        'spf-se',
        'Eucerin',
        'Oil Control SPF 50+',
        ProductCategory.SunProtection,
        ['uv filters'],
      ),
      shelfProduct(
        'bha-se',
        "Paula's Choice",
        'Skin Perfecting 2% BHA Liquid Exfoliant',
        ProductCategory.Exfoliant,
        ['salicylic acid'],
      ),
    ],
    allProducts: [],
    productPerformance: [],
    aiPlanResponse: {
      coverage: {
        slots: [
          filled('cleanse', 'cleanser-se'),
          filled('moisturise', 'moisturizer-se'),
          filled('spf', 'spf-se'),
          filled('texture-exfoliant', 'bha-se'),
          filled('acne-treatment', 'bha-se'),
        ],
      },
      gaps: [],
    },
    productPickResponse: null,
    expected: {
      coverageRoles: [
        'cleanse',
        'moisturise',
        'spf',
        'texture-exfoliant',
        'acne-treatment',
      ],
      priorityGapKeys: [],
      considerGapKeys: [],
      blockedSafetyGapCount: 0,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: null,
    },
    manualReviewChecklist: [
      'Does the plan confidently recommend buying nothing new?',
      'Does coverage reflect the maintenance goal rather than a generic routine?',
      'Does the absence of gaps avoid triggering a false no-pick quality alarm?',
      'Does redundancy elsewhere remain responsible for duplicate-active warnings?',
    ],
  },
  {
    id: 'starter_oily_congestion_drugstore_us',
    mode: 'starter',
    countryCode: 'US',
    city: 'Chicago',
    budgetTier: 'drugstore',
    skinType: 'oily',
    skinTone: 'medium',
    ethnicity: 'Mexican American',
    primaryGoal: 'reduce clogged pores and breakouts without stripping',
    currentConcerns: ['clogged pores', 'breakouts', 'oiliness'],
    pregnancyStatus: null,
    ingredientDislikes: ['heavy fragrance'],
    reactionTriggers: ['over-scrubbing'],
    activeTolerances: {},
    activeProducts: [],
    allProducts: [],
    productPerformance: [],
    aiPlanResponse: {
      coverage: {
        slots: [
          missingPriority('cleanse'),
          missingPriority('moisturise'),
          missingPriority('spf'),
          missingPriority('acne-treatment'),
          missing('barrier-support', 'supportive'),
          missing('congestion-mask', 'optional'),
        ],
      },
      gaps: [
        planGap(
          'Low-stripping gentle cleanser',
          'priority',
          'Congestion-prone skin still needs a cleanser that does not leave the routine tight or reactive.',
          'Start without stripping the skin.',
          'breakout routine support',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Lightweight barrier-support moisturizer',
          'priority',
          'A light moisturizer helps keep breakout treatment tolerable instead of chasing oiliness with dryness.',
          'Keep treatment tolerable.',
          'barrier support',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Broad-spectrum sunscreen SPF 30+',
          'priority',
          'Daily sunscreen protects the starter routine and helps reduce marks left after breakouts.',
          'Protect the routine each morning.',
          'daily protection',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.AadSunscreenSelection],
        ),
        planGap(
          'Adapalene or benzoyl peroxide breakout treatment',
          'priority',
          'The goal points to breakouts, so one leave-on treatment lane is more useful than adding multiple toners.',
          'Add one clear breakout-treatment lane.',
          'breakout control',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.AadAcneTreatment],
        ),
      ],
    },
    productPickResponse: null,
    expected: {
      coverageRoles: ['cleanse', 'moisturise', 'spf', 'acne-treatment'],
      priorityGapKeys: [
        'low-stripping-gentle-cleanser',
        'lightweight-barrier-support-moisturizer',
        'sensitive-skin-sunscreen',
        'adapalene-or-benzoyl-peroxide-breakout-treatment',
      ],
      considerGapKeys: [],
      blockedSafetyGapCount: 1,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: null,
    },
    manualReviewChecklist: [
      'Does the starter kit keep the routine simple for a drugstore budget?',
      'Does it recommend one breakout treatment lane instead of many actives?',
      'Does it avoid fragrance-heavy suggestions after the user preference signal?',
      'Does it keep moisturizer and sunscreen in the plan despite oiliness?',
    ],
  },
  {
    id: 'refine_reactive_barrier_france_irritation_replacement',
    mode: 'refine',
    countryCode: 'FR',
    city: 'Paris',
    budgetTier: 'mid',
    skinType: 'sensitive',
    skinTone: 'medium deep',
    ethnicity: 'French Caribbean',
    primaryGoal: 'calm redness and rebuild barrier after irritation',
    currentConcerns: ['redness', 'sensitivity', 'barrier damage'],
    pregnancyStatus: null,
    ingredientDislikes: ['fragrance', 'strong acids'],
    reactionTriggers: ['glycolic acid toner'],
    activeTolerances: {},
    activeProducts: [
      shelfProduct(
        'cleanser-fr',
        'Bioderma',
        'Sensibio Gel Moussant',
        ProductCategory.Cleanser,
        ['glycerin'],
      ),
      shelfProduct(
        'acid-toner-fr',
        'Glow Brand',
        'Glycolic Night Toner',
        ProductCategory.Exfoliant,
        ['glycolic acid', 'fragrance'],
      ),
      shelfProduct(
        'spf-fr',
        'La Roche-Posay',
        'Anthelios UVMune 400 SPF 50+',
        ProductCategory.SunProtection,
        ['uv filters'],
      ),
    ],
    allProducts: [],
    productPerformance: [
      {
        productId: 'acid-toner-fr',
        brand: 'Glow Brand',
        productName: 'Glycolic Night Toner',
        category: ProductCategory.Exfoliant,
        usageDaysLast30: 14,
        usageDaysLast90: 38,
        photoCheckpoints: 3,
        goalTrend: SmartPicksProductPerformanceSignal.IrritationSignal,
        replacementCandidate: true,
        replacementReason:
          'Use logs and photo checkpoints show repeated redness after this exfoliant. This supports considering a gentler barrier-focused replacement, not proof of causation.',
      },
    ],
    aiPlanResponse: {
      coverage: {
        slots: [
          filled('cleanse', 'cleanser-fr'),
          filled('spf', 'spf-fr'),
          missingPriority('barrier-support'),
          missing('recovery-mask', 'optional'),
        ],
      },
      gaps: [
        planGap(
          'Replacement calming barrier serum',
          'priority',
          'The current exfoliant has enough use and photo history to justify a gentler barrier-focused replacement.',
          'Replace the irritating exfoliant.',
          'redness support',
          SmartPicksGapKind.Replacement,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
          'acid-toner-fr',
        ),
        planGap(
          'Ceramide barrier moisturizer',
          'priority',
          'The shelf has cleanser and sunscreen, but no clear moisturizer to support barrier recovery.',
          'Add a barrier moisturizer.',
          'barrier support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Recovery mask or balm',
          'consider',
          'An occasional recovery step can support flare days without adding another strong active.',
          'Optional recovery support.',
          'redness support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
      ],
    },
    productPickResponse: null,
    expected: {
      coverageRoles: ['cleanse', 'spf', 'barrier-support', 'recovery-mask'],
      priorityGapKeys: [
        'replacement-calming-barrier-serum',
        'ceramide-barrier-moisturizer',
      ],
      considerGapKeys: ['recovery-mask-or-balm'],
      blockedSafetyGapCount: 1,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: null,
    },
    manualReviewChecklist: [
      'Does the replacement reason use history as support rather than clinical proof?',
      'Does the output move away from strong acids after irritation signals?',
      'Does it prioritize barrier recovery before optional extras?',
      'Does it avoid raw photo or journal details in evaluator output?',
    ],
  },
  {
    id: 'starter_firmness_texture_luxury_japan',
    mode: 'starter',
    countryCode: 'JP',
    city: 'Tokyo',
    budgetTier: 'luxury',
    skinType: 'normal',
    skinTone: 'light medium',
    ethnicity: 'Japanese',
    primaryGoal: 'improve early fine lines and keep texture smooth',
    currentConcerns: ['fine lines', 'texture'],
    pregnancyStatus: null,
    ingredientDislikes: [],
    reactionTriggers: [],
    activeTolerances: {},
    activeProducts: [],
    allProducts: [],
    productPerformance: [],
    aiPlanResponse: {
      coverage: {
        slots: [
          missingPriority('cleanse'),
          missingPriority('moisturise'),
          missingPriority('spf'),
          missingPriority('retinoid'),
          missing('peptide', 'supportive'),
          missing('antioxidant', 'supportive'),
          missing('exfoliation-mask', 'optional'),
        ],
      },
      gaps: [
        planGap(
          'Low-stripping gentle cleanser',
          'priority',
          'A starter routine needs a gentle cleanser before texture-focused treatment steps.',
          'Start with a gentle cleanse step.',
          'starter routine',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Barrier-support moisturizer',
          'priority',
          'Moisturizer helps keep retinoid or resurfacing steps tolerable.',
          'Keep treatment tolerable.',
          'barrier support',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Broad-spectrum sunscreen SPF 50',
          'priority',
          'Daily sunscreen is essential before adding texture or fine-line treatments.',
          'Protect progress each morning.',
          'daily protection',
          SmartPicksGapKind.Starter,
          [SuggestionEvidenceSourceId.AadSunscreenSelection],
        ),
        planGap(
          'Beginner retinal night treatment',
          'priority',
          'A carefully introduced retinal step is the most direct treatment lane for fine lines and texture when safety context allows it.',
          'Add one retinoid lane slowly.',
          'fine line and texture support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.AadRetinoidRetinol],
        ),
        planGap(
          'Peptide support serum',
          'consider',
          'Peptide support can be useful on recovery nights when the retinoid is not used.',
          'Optional recovery-night support.',
          'firmness support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
        planGap(
          'Vitamin C antioxidant serum',
          'consider',
          'Antioxidant support can complement sunscreen for long-view tone and texture support.',
          'Optional antioxidant support.',
          'tone and texture support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
        ),
      ],
    },
    productPickResponse: null,
    expected: {
      coverageRoles: [
        'cleanse',
        'moisturise',
        'spf',
        'retinoid',
        'peptide',
        'antioxidant',
      ],
      priorityGapKeys: [
        'low-stripping-gentle-cleanser',
        'barrier-support-moisturizer',
        'broad-spectrum-sunscreen-spf-50',
        'beginner-retinal-night-treatment',
      ],
      considerGapKeys: ['peptide-support-serum', 'vitamin-c-antioxidant-serum'],
      minimumConsiderGapCount: 2,
      blockedSafetyGapCount: 0,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: null,
    },
    manualReviewChecklist: [
      'Does the high budget produce a complete but still staged starter routine?',
      'Does the treatment lane directly match texture and fine lines?',
      'Are optional supports secondary to sunscreen, moisturizer, and retinoid pacing?',
      'Does the output avoid promising fast or guaranteed results?',
    ],
  },
  {
    id: 'refine_body_roughness_mid_germany',
    mode: 'refine',
    countryCode: 'DE',
    city: 'Berlin',
    budgetTier: 'mid',
    skinType: 'dry combination',
    skinTone: 'fair medium',
    ethnicity: 'German Turkish',
    primaryGoal: 'smooth rough bumps on arms without irritating my face',
    currentConcerns: ['rough bumps', 'body texture', 'dryness'],
    pregnancyStatus: null,
    ingredientDislikes: ['fragrance'],
    reactionTriggers: [],
    activeTolerances: {},
    activeProducts: [
      shelfProduct(
        'cleanser-de',
        'CeraVe',
        'Hydrating Cleanser',
        ProductCategory.Cleanser,
        ['glycerin', 'ceramide np'],
      ),
      shelfProduct(
        'moisturizer-de',
        'Balea',
        'Med Ultra Sensitive Intensivcreme',
        ProductCategory.Moisturizer,
        ['glycerin', 'panthenol'],
      ),
      shelfProduct(
        'spf-de',
        'Garnier',
        'Sensitive Advanced SPF 50+',
        ProductCategory.SunProtection,
        ['uv filters'],
      ),
    ],
    allProducts: [],
    productPerformance: [],
    aiPlanResponse: {
      coverage: {
        slots: [
          filled('cleanse', 'cleanser-de'),
          filled('moisturise', 'moisturizer-de'),
          filled('spf', 'spf-de'),
          missingPriority('texture-exfoliant'),
          missing('barrier-support', 'supportive'),
        ],
      },
      gaps: [
        planGap(
          'Gentle body exfoliant with lactic acid or urea',
          'priority',
          'The shelf covers face basics, but the stated body roughness goal needs a body-appropriate smoothing lane.',
          'Add one body smoothing lane.',
          'body texture support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
        ),
        planGap(
          'Fragrance-free body barrier moisturizer',
          'consider',
          'A richer body moisturizer can help dryness around the smoothing step without becoming another active.',
          'Optional body barrier support.',
          'dryness support',
          SmartPicksGapKind.GoalSupport,
          [SuggestionEvidenceSourceId.MayoDrySkinCare],
        ),
      ],
    },
    productPickResponse: null,
    expected: {
      coverageRoles: [
        'cleanse',
        'moisturise',
        'spf',
        'texture-exfoliant',
        'barrier-support',
      ],
      priorityGapKeys: ['gentle-body-exfoliant-with-lactic-acid-or-urea'],
      considerGapKeys: ['fragrance-free-body-barrier-moisturizer'],
      blockedSafetyGapCount: 0,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      acceptedProductPickCount: null,
    },
    manualReviewChecklist: [
      'Does the plan honor the body-specific goal instead of only face routine roles?',
      'Does it use one appropriate smoothing lane rather than multiple exfoliants?',
      'Does it keep fragrance avoidance in the optional support wording?',
      'Does coverage stay goal-specific rather than generic?',
    ],
  },
] as const satisfies readonly GoldenSmartPicksPersona[];

function shelfProduct(
  id: string,
  brand: string,
  name: string,
  category: ProductCategory,
  ingredients: string[],
): GoldenSmartPicksProduct {
  return {
    id,
    brand,
    name,
    category,
    status: ShelfStatus.Active,
    ingredients,
    benefits: [],
  };
}

function filled(
  role: SmartPicksCoverageRole,
  filledByProductId: string,
): GoldenCoverageSlot {
  return {
    role,
    state: 'filled',
    filledByProductId,
    goalRelevance: 'essential',
  };
}

function missingPriority(role: SmartPicksCoverageRole): GoldenCoverageSlot {
  return missing(role, 'essential', 'missing-priority');
}

function missing(
  role: SmartPicksCoverageRole,
  goalRelevance: 'essential' | 'supportive' | 'optional',
  state = 'missing',
): GoldenCoverageSlot {
  return {
    role,
    state,
    filledByProductId: null,
    goalRelevance,
  };
}

function planGap(
  ingredientOrCategory: string,
  priority: 'priority' | 'consider',
  reason: string,
  shortReason: string,
  goalAlignment: string,
  gapKind: SmartPicksGapKind,
  sourceIds: SuggestionEvidenceSourceId[],
  replacementForProductId: string | null = null,
): GoldenPlanGap {
  return {
    ingredientOrCategory,
    priority,
    reason,
    shortReason,
    goalAlignment,
    sourceIds,
    gapKind,
    replacementForProductId,
  };
}

function productPick(
  normalizedKey: string,
  brand: string,
  productName: string,
  budgetTier: SmartPicksBudgetTier,
  recommendationRankReason: string,
): GoldenProductPick {
  return {
    normalizedKey,
    brand,
    productName,
    budgetTier,
    recommendationRankReason,
    sellerNames: ['Brand site', 'Dermstore'],
    reasoningChips: [
      { tone: 'goal', text: 'Goal fit', icon: 'target' },
      { tone: 'compatibility', text: 'Routine fit', icon: 'layers' },
    ],
    reasoningFacts: [
      { label: 'Why', value: recommendationRankReason },
      {
        label: 'Evidence',
        value: 'Photo and use history are support signals.',
      },
    ],
    ruledOut: [
      {
        brand: 'Less Fit',
        productName: 'Generic Option',
        reason: 'Less directly matched to the stated gap.',
      },
    ],
    alternatives: [],
    sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
  };
}
