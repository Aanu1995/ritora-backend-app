import { SuggestionEvidenceSourceId } from '../suggestions/suggestions.constants';

export type SmartPicksMode = 'refine' | 'starter';
export const SMART_PICKS_MODES: readonly SmartPicksMode[] = [
  'refine',
  'starter',
] as const;

export type SmartPicksBudgetTier = 'drugstore' | 'mid' | 'premium' | 'luxury';

export const SMART_PICKS_BUDGET_TIERS: readonly SmartPicksBudgetTier[] = [
  'drugstore',
  'mid',
  'premium',
  'luxury',
] as const;

export type SmartPicksAvailabilityStatus =
  | 'local'
  | 'import_only'
  | 'unavailable'
  | 'unknown';

export const SMART_PICKS_AVAILABILITY_STATUSES: readonly SmartPicksAvailabilityStatus[] =
  ['local', 'import_only', 'unavailable', 'unknown'] as const;

export type SmartPicksProductVerificationStatus =
  | 'ai_named'
  | 'retailer_verified'
  | 'retailer_unverified'
  | 'unavailable';

export const SMART_PICKS_PRODUCT_VERIFICATION_STATUSES: readonly SmartPicksProductVerificationStatus[] =
  [
    'ai_named',
    'retailer_verified',
    'retailer_unverified',
    'unavailable',
  ] as const;

export const SmartPicksGapKind = {
  Missing: 'missing',
  Environment: 'environment',
  Starter: 'starter',
  Replacement: 'replacement',
} as const;

export type SmartPicksGapKind =
  (typeof SmartPicksGapKind)[keyof typeof SmartPicksGapKind];

export const SmartPicksProductPerformanceSignal = {
  Working: 'working',
  NotImproving: 'not_improving',
  IrritationSignal: 'irritation_signal',
  InsufficientHistory: 'insufficient_history',
} as const;

export type SmartPicksProductPerformanceSignal =
  (typeof SmartPicksProductPerformanceSignal)[keyof typeof SmartPicksProductPerformanceSignal];

export const SmartPicksProductAdherence = {
  None: 'none',
  Light: 'light',
  Consistent: 'consistent',
} as const;

export type SmartPicksProductAdherence =
  (typeof SmartPicksProductAdherence)[keyof typeof SmartPicksProductAdherence];

export interface SmartPicksProductPerformanceSummary {
  productId: string;
  brand: string;
  productName: string;
  category: string | null;
  usageDaysLast30: number;
  usageDaysLast90: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
  adherence: SmartPicksProductAdherence;
  goalTrend: SmartPicksProductPerformanceSignal;
  concernTrend: string | null;
  photoCheckpoints: number;
  reactionSignalCount: number;
  replacementCandidate: boolean;
  replacementReason: string | null;
}

export const SmartPicksEmptyReason = {
  ProfileRequired: 'profile_required',
  ConsentRequired: 'consent_required',
  FullyCovered: 'fully_covered',
  AllGapsDismissed: 'all_gaps_dismissed',
  RedundancyOnly: 'redundancy_only',
  StarterNeedsShelf: 'starter_needs_shelf',
  HistoryInsufficient: 'history_insufficient',
  ProductGenerationUnavailable: 'product_generation_unavailable',
} as const;

export type SmartPicksEmptyReason =
  (typeof SmartPicksEmptyReason)[keyof typeof SmartPicksEmptyReason];

export const SmartPicksHistoryReadinessReason = {
  Ready: 'ready',
  NeedsUsageLogs: 'needs_usage_logs',
  NeedsClearPhotos: 'needs_clear_photos',
  NeedsUsageAndPhotos: 'needs_usage_and_photos',
} as const;

export type SmartPicksHistoryReadinessReason =
  (typeof SmartPicksHistoryReadinessReason)[keyof typeof SmartPicksHistoryReadinessReason];

export const SmartPicksMissingProfileField = {
  DateOfBirth: 'date_of_birth',
  SexAtBirth: 'sex_at_birth',
  SkinType: 'skin_type',
  SkinTone: 'skin_tone',
  FitzpatrickPhototype: 'fitzpatrick_phototype',
  Ethnicity: 'ethnicity',
  CurrentConcerns: 'current_concerns',
  PrimaryGoal: 'primary_goal',
  ConcernSeverity: 'concern_severity',
  PihTendency: 'pih_tendency',
  MelasmaTendency: 'melasma_tendency',
  KeloidTendency: 'keloid_tendency',
  SunscreenHabit: 'sunscreen_habit',
  SunscreenTolerance: 'sunscreen_tolerance',
  RoutinePace: 'routine_pace',
  FragranceFree: 'fragrance_free',
  NonComedogenic: 'non_comedogenic',
  SunscreenFilter: 'sunscreen_filter',
  SunscreenFinish: 'sunscreen_finish',
  WaterHardness: 'water_hardness',
  WaterSensitivity: 'water_sensitivity',
  BudgetTier: 'budget_tier',
  SmartPicksConsent: 'smart_picks_consent',
} as const;

export type SmartPicksMissingProfileField =
  (typeof SmartPicksMissingProfileField)[keyof typeof SmartPicksMissingProfileField];

export interface SmartPicksHistoryReadiness {
  usablePhotoCheckpoints: number;
  loggedUseDaysLast90: number;
  canAssessReplacements: boolean;
  reason: SmartPicksHistoryReadinessReason;
}

export interface SmartPicksEmptyState {
  reason: SmartPicksEmptyReason | null;
  dismissedGapCount: number;
  nextEligibleAt: string | null;
  missingProfileFields: SmartPicksMissingProfileField[];
  activeProductCount: number;
  canAssessReplacements: boolean;
  historyReadiness: SmartPicksHistoryReadiness;
}

export type SmartPicksCoverageRole =
  | 'cleanse'
  | 'hydrate'
  | 'treat'
  | 'moisturise'
  | 'spf'
  | 'eye'
  | 'treatment-secondary';

export type SmartPicksCoverageState = 'filled' | 'missing' | 'missing-priority';

export type SmartPicksGoalRelevance = 'essential' | 'supportive' | 'optional';

export interface SmartPicksCoverageSlot {
  role: SmartPicksCoverageRole;
  state: SmartPicksCoverageState;
  filledByProductId: string | null;
  filledByName: string | null;
  goalRelevance: SmartPicksGoalRelevance;
}

export interface SmartPicksCoverage {
  slots: SmartPicksCoverageSlot[];
  filled: number;
  total: number;
}

export interface SmartPicksRetailer {
  name: string;
  url: string;
  priceCents: number | null;
  currency: string | null;
  inStock: boolean;
  isAffiliate: boolean;
}

export type SmartPicksReasoningChipTone =
  | 'goal'
  | 'budget'
  | 'ethnicity'
  | 'compatibility'
  | 'location'
  | 'safety';

export interface SmartPicksReasoningChip {
  tone: SmartPicksReasoningChipTone;
  text: string;
  icon: string;
}

export interface SmartPicksRuledOutProduct {
  brand: string;
  productName: string;
  priceCents: number | null;
  currency: string | null;
  reason: string;
}

export interface SmartPicksProductPick {
  id: string;
  brand: string;
  productName: string;
  budgetTier: SmartPicksBudgetTier | null;
  priceCents: number | null;
  currency: string | null;
  retailers: SmartPicksRetailer[];
  reasoningChips: SmartPicksReasoningChip[];
  reasoningFacts: Record<string, string>;
  ruledOut: SmartPicksRuledOutProduct[];
  sourceIds: SuggestionEvidenceSourceId[];
  alternatives: SmartPicksProductPick[];
  verificationStatus: SmartPicksProductVerificationStatus;
  availabilityStatus: SmartPicksAvailabilityStatus;
  recommendationRankReason: string | null;
  localAlternativeReason: string | null;
  retailerDataCheckedAt: string | null;
  retailerDataStale: boolean;
  userAction: 'saved' | 'dismissed' | null;
  createdAt: string;
}

export const SmartPicksStarterKitStepStatus = {
  Covered: 'covered',
  Recommended: 'recommended',
  Wait: 'wait',
} as const;

export type SmartPicksStarterKitStepStatus =
  (typeof SmartPicksStarterKitStepStatus)[keyof typeof SmartPicksStarterKitStepStatus];

export interface SmartPicksStarterKitStep {
  order: number;
  role: SmartPicksCoverageRole;
  title: string;
  ingredientOrCategory: string;
  normalizedKey: string;
  status: SmartPicksStarterKitStepStatus;
  ownedProductId: string | null;
  ownedProductName: string | null;
  reason: string;
  pick: SmartPicksProductPick | null;
  sourceIds: SuggestionEvidenceSourceId[];
}

export interface SmartPicksStarterKit {
  summary: string | null;
  steps: SmartPicksStarterKitStep[];
}

export interface SmartPicksGapSnapshot {
  ingredientOrCategory: string;
  normalizedKey: string;
  priority: 'priority' | 'consider';
  reason: string;
  goalAlignment: string | null;
  sourceIds: SuggestionEvidenceSourceId[];
  gapKind: SmartPicksGapKind;
  replacementFor: SmartPicksProductPerformanceSummary | null;
}

export type SmartPicksGap = SmartPicksGapSnapshot & {
  pick: SmartPicksProductPick | null;
};

export interface SmartPicksCoveredItem {
  role: string;
  productName: string;
  reason: string;
}

export interface SmartPicksRedundancyGroup {
  activeTag: string;
  products: {
    id: string;
    brand: string;
    name: string;
    recommendation: 'keep' | 'finish-first' | 'redundant';
  }[];
  hint: string;
}

export interface SmartPicksRecap {
  primaryGoal: string | null;
  skinType: string | null;
  location: { city: string | null; countryCode: string | null };
  budgetTier: SmartPicksBudgetTier | null;
  ethnicity: string | null;
}

export interface SmartPicksSnapshotPayload {
  recap: SmartPicksRecap;
  coverage: SmartPicksCoverage;
  priorityGaps: SmartPicksGapSnapshot[];
  considerGaps: SmartPicksGapSnapshot[];
  covered: SmartPicksCoveredItem[];
  redundancy: SmartPicksRedundancyGroup[];
}

export interface SmartPicksOverview {
  mode: SmartPicksMode;
  generatedAt: string;
  inputsHash: string;
  recap: SmartPicksRecap;
  coverage: SmartPicksCoverage;
  priorityGaps: SmartPicksGap[];
  considerGaps: SmartPicksGap[];
  covered: SmartPicksCoveredItem[];
  redundancy: SmartPicksRedundancyGroup[];
  consentRequired: boolean;
  skinProfileRequired: boolean;
  productSuggestionsUnavailable: boolean;
  emptyState: SmartPicksEmptyState;
  starterKit: SmartPicksStarterKit;
}

export interface SmartPicksWishlistItem {
  actionId: string;
  savedAt: string;
  ingredientOrCategory: string;
  normalizedKey: string;
  reason: string | null;
  goalAlignment: string | null;
  pick: SmartPicksProductPick;
}
