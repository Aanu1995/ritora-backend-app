export enum CommunityContentType {
  Routine = 'routine',
  Review = 'review',
}

export enum CommunityModerationStatus {
  Draft = 'draft',
  PendingReview = 'pending_review',
  Published = 'published',
  NeedsEdit = 'needs_edit',
  Hidden = 'hidden',
  Rejected = 'rejected',
}

export enum CommunityDisclosureType {
  Ordinary = 'ordinary',
  Gifted = 'gifted',
  Sponsored = 'sponsored',
  Affiliate = 'affiliate',
  Professional = 'professional',
  BrandRep = 'brand_rep',
}

export enum CommunitySafetySeverity {
  Info = 'info',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum CommunityReportReason {
  UnsafeAdvice = 'unsafe_advice',
  MedicalClaims = 'medical_claims',
  Harassment = 'harassment',
  Spam = 'spam',
  UndisclosedSponsorship = 'undisclosed_sponsorship',
  MisleadingBeforeAfter = 'misleading_before_after',
  PrivacyViolation = 'privacy_violation',
  Other = 'other',
}

export enum CommunityReportStatus {
  Open = 'open',
  Triaged = 'triaged',
  Closed = 'closed',
}

export enum CommunityHelpfulnessVote {
  Helpful = 'helpful',
  NotHelpful = 'not_helpful',
}

export enum CommunityListSort {
  Newest = 'newest',
}

export enum CommunityGoalResult {
  Achieved = 'achieved',
  MostlyImproved = 'mostly_improved',
  PartiallyImproved = 'partially_improved',
  Maintained = 'maintained',
  Mixed = 'mixed',
}

export enum CommunityGoalTimeframe {
  TwoWeeks = '2-weeks',
  FourWeeks = '4-weeks',
  EightWeeks = '8-weeks',
  ThreeMonths = '3-months',
  ThreeMonthsPlus = '3-months-plus',
  SixMonths = '6-months',
  TwelveMonthsPlus = '12-months-plus',
}

export enum CommunityOutcomeSignal {
  WorkedForMeToo = 'worked_for_me_too',
  WorkedWithChanges = 'worked_with_changes',
  MixedResult = 'mixed_result',
  DidNotWork = 'did_not_work',
  CausedIrritation = 'caused_irritation',
  NotRelevant = 'not_relevant',
}

export enum CommunityOutcomeTrialDuration {
  UnderTwoWeeks = 'under-2-weeks',
  TwoWeeks = '2-weeks',
  FourWeeks = '4-weeks',
  EightWeeks = '8-weeks',
  ThreeMonthsPlus = '3-months-plus',
}

export enum CommunityOutcomeFollowedPart {
  Products = 'products',
  RoutineTiming = 'routine-timing',
  AvoidList = 'avoid-list',
  Habits = 'habits',
  Partial = 'partial',
}

export enum CommunityOutcomeIrritationLevel {
  None = 'none',
  Mild = 'mild',
  Moderate = 'moderate',
  Severe = 'severe',
}

export type CommunityOutcomeSignalProductContext = {
  productBrand: string | null;
  productName: string | null;
  category: string;
};

export type CommunityOutcomeSignalContext = {
  sameGoal: boolean;
  trialDuration: CommunityOutcomeTrialDuration;
  followedParts: CommunityOutcomeFollowedPart[];
  irritationLevel: CommunityOutcomeIrritationLevel;
  routineSlot: CommunityReviewRoutineSlot | null;
  usedWithProducts: CommunityOutcomeSignalProductContext[];
};

export type CommunityReviewResultPublic = {
  id: string;
  signal: CommunityOutcomeSignal;
  sameGoal: boolean;
  trialDuration: CommunityOutcomeTrialDuration;
  followedParts: CommunityOutcomeFollowedPart[];
  irritationLevel: CommunityOutcomeIrritationLevel;
  routineSlot: CommunityReviewRoutineSlot | null;
  usedWithProducts: CommunityOutcomeSignalProductContext[];
  note: string | null;
  noteModerationStatus: CommunityModerationStatus;
  similarToViewer: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CommunityReviewResultsResponse = {
  counts: Record<CommunityOutcomeSignal, number>;
  items: CommunityReviewResultPublic[];
  nextCursor: string | null;
};

export enum CommunityReviewRoutineSlot {
  AM = 'am',
  PM = 'pm',
  AMPM = 'am-pm',
  Either = 'either',
}

export enum CommunityReviewRoutineContextUsage {
  UsedAlone = 'used_alone',
  WithProducts = 'with_products',
  NotSure = 'not_sure',
}

export enum CommunityReviewSkinResponse {
  Improved = 'improved',
  NoChange = 'no_change',
  Mixed = 'mixed',
  Worsened = 'worsened',
}

export enum CommunityAdaptationChangeType {
  Kept = 'kept',
  Swapped = 'swapped',
  Removed = 'removed',
  Gap = 'gap',
}

export type CommunitySafeProfileFacets = {
  skinType: string | null;
  concernTags: string[];
  sensitivityLevel: string | null;
  skinToneRange: string | null;
  climateBucket: string | null;
  routinePace: string | null;
  goalTags: string[];
};

export type CommunitySafetyFlag = {
  code: string;
  severity: CommunitySafetySeverity;
  message: string;
};

export type CommunitySafetyScanSnapshot = {
  flags: CommunitySafetyFlag[];
  status: CommunityModerationStatus;
  scannedTextLength: number;
  scannerVersion: string;
  automation?: CommunityModerationAutomationSnapshot;
};

export type CommunityModerationAutomationAction =
  | 'publish'
  | 'request_edit'
  | 'admin_review';

export type CommunityModerationAutomationSnapshot = {
  action: CommunityModerationAutomationAction;
  handledBy: 'automation' | 'admin';
  reason: string;
  critical: boolean;
  confidence: number;
  provider: 'openai' | 'deterministic_fallback';
  model: string | null;
  fallbackReason: string | null;
  durationMs: number;
};

export type CommunityRoutineStepSnapshot = {
  stepOrder: number;
  slot: 'am' | 'pm' | 'either';
  productId: string | null;
  productBrand: string | null;
  productName: string | null;
  category: string;
  frequency: string | null;
  notes: string | null;
};

export type CommunityRoutineStepPublic = {
  stepOrder: number;
  slot: 'am' | 'pm' | 'either';
  productBrand: string | null;
  productName: string | null;
  category: string;
  frequency: string | null;
  notes: string | null;
};

export type CommunityRoutineContextProductSnapshot = {
  productId: string | null;
  productBrand: string | null;
  productName: string | null;
  category: string;
};

export type CommunityRoutineContextProductPublic = {
  productBrand: string | null;
  productName: string | null;
  category: string;
};

export type CommunityAdaptationChange = {
  changeType: CommunityAdaptationChangeType;
  stepOrder: number;
  sourceProductName: string | null;
  sourceProductBrand: string | null;
  targetProductId: string | null;
  targetProductName: string | null;
  targetProductBrand: string | null;
  category: string;
  reason: string;
};
