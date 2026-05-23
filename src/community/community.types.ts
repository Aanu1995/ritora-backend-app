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
