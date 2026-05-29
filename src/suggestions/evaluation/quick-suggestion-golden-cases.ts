import {
  ApplicationMethod,
  DataProvenance,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfStatus,
} from '../../shelf/shelf.types';
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

const TARGET_DATE = '2026-05-29';

export const QUICK_SUGGESTION_GOLDEN_CASES: readonly TodaysSuggestionEvaluationCase[] =
  [
    ...TODAYS_SUGGESTION_GOLDEN_CASES.filter(
      (evaluationCase) =>
        evaluationCase.inputs.requestSource ===
        SuggestionRequestSource.OnDemand,
    ),
    buildNoExtraStepNeededCase(),
  ];

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

function productWithPreferredTime(input: {
  id: string;
  name: string;
  category: ProductCategory;
  preferredTimeOfDay: PreferredTimeOfDay;
}): InventoryProduct {
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
    description: 'Broad-spectrum daily sunscreen.',
    benefits: ['spf'],
    suitedFor: ['daily protection'],
    inciIngredients: ['zinc oxide'],
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
  requestContext: SuggestionRequestContextJson;
  profile: SkinProfile;
  product: InventoryProduct;
}): SuggestionContextSummary {
  return {
    cacheKey: 'quick-eval-no-extra-step',
    builtAt: '2026-05-29T20:30:00.000Z',
    targetDate: TARGET_DATE,
    targetTime: '20:30',
    daypart: SuggestionDaypart.Evening,
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
    productScores: [
      {
        productId: input.product.id,
        brand: input.product.brand,
        name: input.product.name,
        category: input.product.category,
        preferredTimeOfDay: PreferredTimeOfDay.Morning,
        activeTags: ['spf'],
        suitabilityScore: 92,
        suitabilityReasons: [
          'Good daytime sunscreen, but not needed indoors tonight.',
        ],
        cautionReasons: [],
        waitMinutes: null,
        inciQuality: 'available',
        dataQuality: 'verified',
        dataQualityWarnings: [],
        evidenceSourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
      },
    ],
    applicationPatterns: {
      days: 0,
      daysSinceLastApplication: null,
      conservativeRestart: false,
      skippedByCategory: {},
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
  };
}
