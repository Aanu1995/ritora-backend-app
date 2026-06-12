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
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import type { SuggestionContextSummary } from '../suggestion-context.types';
import {
  SuggestionDaypart,
  SuggestionEvidenceSourceId,
  SuggestionRequestContextJson,
  SuggestionRequestSource,
} from '../suggestions.constants';
import { getSuggestionEvidenceSources } from '../services/suggestion-evidence-sources';
import {
  TODAYS_SUGGESTION_GOLDEN_CASES,
  type TodaysSuggestionEvaluationCase,
} from './todays-suggestion-golden-cases';

export const QUICK_SUGGESTION_NO_STEP_CASE_ID = 'quick_no_extra_step_needed';
export const QUICK_SUGGESTION_PLAIN_SKIP_CASE_ID =
  'quick_plain_skip_does_not_suppress_spf';
export const QUICK_SUGGESTION_CATEGORY_OPEN_CASE_ID =
  'quick_category_open_non_serum_evening';

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
        evidenceSourceIds:
          product.category === ProductCategory.SunProtection
            ? [SuggestionEvidenceSourceId.AadSunscreenSelection]
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
    safetyConstraints: [],
    governance: {
      safetyPolicyVersion: 'quick-evaluation-2026-05-29',
      safetyPolicyReviewedAt: '2026-05-29',
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
    evidenceSources: getSuggestionEvidenceSources([
      SuggestionEvidenceSourceId.AadSunscreenSelection,
      SuggestionEvidenceSourceId.MayoDrySkinCare,
    ]),
    skippedCandidates: [],
    routineMemory: {
      recordsConsidered: (input.recentApplications ?? []).length,
      previousSuggestionCount: 0,
      sameDaypartSuggestionCount: 0,
      recentSameDaypartFingerprints: [],
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
