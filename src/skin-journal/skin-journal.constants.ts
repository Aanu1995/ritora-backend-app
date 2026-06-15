export type Angle = 'head_on' | 'left_profile' | 'right_profile';

export const SKIN_JOURNAL_PHOTO_ANGLES = [
  'left_profile',
  'head_on',
  'right_profile',
] as const satisfies readonly Angle[];

export const SKIN_JOURNAL_FRONT_PHOTO_ANGLE: Angle = 'head_on';

export const SKIN_JOURNAL_SIDE_PHOTO_ANGLES = [
  'left_profile',
  'right_profile',
] as const satisfies readonly Angle[];

export const AnalysisStatusValue = {
  Pending: 'pending',
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  NeedsReview: 'needs_review',
  Skipped: 'skipped',
} as const;

export type AnalysisStatus =
  (typeof AnalysisStatusValue)[keyof typeof AnalysisStatusValue];

export const AnalysisFailureCodeValue = {
  ProviderUnavailable: 'provider_unavailable',
  ProviderRateLimited: 'provider_rate_limited',
  ProviderTimeout: 'provider_timeout',
  ProviderInvalidResponse: 'provider_invalid_response',
  PhotoPreflightRejected: 'photo_preflight_rejected',
  PayloadTooLarge: 'payload_too_large',
  CostLimitExceeded: 'cost_limit_exceeded',
  PlatformGlobalRestriction: 'platform_global_restriction',
  ConfigurationError: 'configuration_error',
  InvalidPhotoInput: 'invalid_photo_input',
  Unknown: 'unknown',
} as const;

export type AnalysisFailureCode =
  (typeof AnalysisFailureCodeValue)[keyof typeof AnalysisFailureCodeValue];

export type OverallFeel = 'awful' | 'bad' | 'ok' | 'good' | 'great';

export type SleepBand = 'lt5h' | '5to7h' | '7to9h' | 'gt9h' | 'skipped';

export type StressLevel = 'low' | 'mid' | 'high';

export type SunExposure = 'none' | 'brief' | 'lots';

export type CycleMarker =
  | 'not_on'
  | 'day_1_3'
  | 'day_4_7'
  | 'late_cycle'
  | 'dont_track';

export type RecentChangeKind =
  | 'started_new_product'
  | 'stopped_a_product'
  | 'changed_frequency'
  | 'got_a_treatment'
  | 'felt_unwell'
  | 'travelled'
  | 'other';

export type EventKind =
  | 'reaction_detected'
  | 'worsening'
  | 'recovery'
  | 'dermatologist_referral'
  | 'product_effectiveness';

export type EventSeverity = 'info' | 'warning' | 'critical';

export type InsightKind =
  | 'onboarding_progress'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'trend'
  | 'correlation'
  | 'effectiveness'
  | 'reaction_recovery'
  | 'referral'
  | 'photo_quality_drift'
  | 'face_zone_pattern'
  | 'routine_adherence'
  | 'cycle'
  | 'ai_summary'
  | 'ai_pattern';

export type InsightGenerationTrigger =
  | 'photo_analysis_completed'
  | 'check_in_updated'
  | 'entry_deleted'
  | 'scheduled_refresh'
  | 'product_or_routine_changed';

export const InsightGenerationStatusValue = {
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
} as const;

export type InsightGenerationStatus =
  (typeof InsightGenerationStatusValue)[keyof typeof InsightGenerationStatusValue];

export const InsightInteractionTypeValue = {
  Seen: 'seen',
  Dismissed: 'dismissed',
  ActionClicked: 'action_clicked',
} as const;

export type InsightInteractionType =
  (typeof InsightInteractionTypeValue)[keyof typeof InsightInteractionTypeValue];

export const INSIGHT_INTERACTION_TYPES = Object.values(
  InsightInteractionTypeValue,
);

export const AnalysisFeedbackVoteValue = {
  Helpful: 'helpful',
  NotHelpful: 'not_helpful',
} as const;

export type AnalysisFeedbackVote =
  (typeof AnalysisFeedbackVoteValue)[keyof typeof AnalysisFeedbackVoteValue];

export const ANALYSIS_FEEDBACK_VOTES = Object.values(AnalysisFeedbackVoteValue);

export const AnalysisFeedbackReasonValue = {
  TooGeneric: 'too_generic',
  WrongConcern: 'wrong_concern',
  WrongLocation: 'wrong_location',
  MissedContext: 'missed_context',
  NotActionable: 'not_actionable',
  PhotoQualityConfusing: 'photo_quality_confusing',
  SourcesNotUseful: 'sources_not_useful',
  Other: 'other',
} as const;

export type AnalysisFeedbackReason =
  (typeof AnalysisFeedbackReasonValue)[keyof typeof AnalysisFeedbackReasonValue];

export const ANALYSIS_FEEDBACK_REASONS = Object.values(
  AnalysisFeedbackReasonValue,
);

export type InsightWindow = 'all' | 'week' | 'month';

export type InsightSourceType = 'deterministic' | 'ai_polished' | 'ai_sourced';

export type InsightEvidenceGrade =
  | 'strong'
  | 'moderate'
  | 'limited'
  | 'anecdotal';

export type WrappedPeriodKind = 'monthly' | 'quarterly' | 'yearly';

export const WrappedStatusValue = {
  NotEnoughPhotos: 'not_enough_photos',
  ReadyToGenerate: 'ready_to_generate',
  Pending: 'pending',
  Generating: 'generating',
  Ready: 'ready',
  Failed: 'failed',
} as const;

export type WrappedStatus =
  (typeof WrappedStatusValue)[keyof typeof WrappedStatusValue];

export type SimplificationMode = 'barrier_repair';

export type RestoreStrategy = 'full' | 'phased';

export const RecoveryPhaseValue = {
  Stabilize: 'stabilize',
  Observe: 'observe',
  PhasedReturn: 'phased_return',
} as const;

export type RecoveryPhase =
  (typeof RecoveryPhaseValue)[keyof typeof RecoveryPhaseValue];

export const RecoveryTriggerSourceValue = {
  Unknown: 'unknown',
  Manual: 'manual',
  ReactionReport: 'reaction_report',
  PhotoAnalysis: 'photo_analysis',
} as const;

export type RecoveryTriggerSource =
  (typeof RecoveryTriggerSourceValue)[keyof typeof RecoveryTriggerSourceValue];

export const RecoveryReturnStepValue = {
  NotStarted: 'not_started',
  BarrierOnly: 'barrier_only',
  OneActiveTest: 'one_active_test',
  BuildingFrequency: 'building_frequency',
  Complete: 'complete',
} as const;

export type RecoveryReturnStep =
  (typeof RecoveryReturnStepValue)[keyof typeof RecoveryReturnStepValue];

export type ReactionSeverity = 'none' | 'mild' | 'moderate' | 'severe';

export const REACTION_REPORT_SYMPTOMS = [
  'burning',
  'stinging',
  'itching',
  'tightness',
  'redness',
  'heat',
  'pain',
  'swelling',
  'hives',
  'peeling',
  'breakout',
  'other',
] as const;

export type ReactionReportSymptom = (typeof REACTION_REPORT_SYMPTOMS)[number];

export const REACTION_REPORT_SEVERITIES = [
  'mild',
  'moderate',
  'severe',
] as const;

export type ReactionReportSeverity =
  (typeof REACTION_REPORT_SEVERITIES)[number];

export const REACTION_REPORT_ONSETS = [
  'today',
  'yesterday',
  'two_to_three_days',
  'four_to_seven_days',
  'more_than_week',
  'unsure',
] as const;

export type ReactionReportOnset = (typeof REACTION_REPORT_ONSETS)[number];

export const REACTION_REPORT_LOCATIONS = [
  'forehead',
  'cheeks',
  'chin_jaw',
  'around_mouth',
  'eye_area',
  'neck',
  'all_over_face',
  'body',
  'other',
] as const;

export type ReactionReportLocation = (typeof REACTION_REPORT_LOCATIONS)[number];

export const REACTION_REPORT_RED_FLAGS = [
  'eye_or_lip_swelling',
  'trouble_breathing',
  'blistering',
  'open_skin',
  'spreading_fast',
  'severe_pain',
  'infection_signs',
] as const;

export type ReactionReportRedFlag = (typeof REACTION_REPORT_RED_FLAGS)[number];

export const REACTION_REPORT_TRIGGERS = [
  'new_product',
  'changed_frequency',
  'active_ingredient',
  'sunscreen',
  'treatment',
  'weather_or_environment',
  'unknown',
] as const;

export type ReactionReportTrigger = (typeof REACTION_REPORT_TRIGGERS)[number];

export const AnalysisJobStatusValue = {
  Queued: 'queued',
  Sent: 'sent',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;

export type AnalysisJobStatus =
  (typeof AnalysisJobStatusValue)[keyof typeof AnalysisJobStatusValue];

export type AnalysisQueueDriver = 'sqs' | 'database';

export const InsightJobStatusValue = {
  Queued: 'queued',
  Sent: 'sent',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;

export type InsightJobStatus =
  (typeof InsightJobStatusValue)[keyof typeof InsightJobStatusValue];

export type InsightQueueDriver = 'sqs' | 'database';

export const MediaDeletionJobStatusValue = {
  Pending: 'pending',
  Verified: 'verified',
  Failed: 'failed',
} as const;

export type MediaDeletionJobStatus =
  (typeof MediaDeletionJobStatusValue)[keyof typeof MediaDeletionJobStatusValue];

export type AnalysisChangeDirection =
  | 'improved'
  | 'worsened'
  | 'stable'
  | 'new'
  | 'not_comparable'
  | 'unknown';

export type AnalysisTrendExclusionReason =
  | 'poor_lighting'
  | 'poor_framing'
  | 'blur'
  | 'no_face_detected'
  | 'occlusion'
  | 'makeup_or_filter_present'
  | 'not_comparable';

export type AnalysisSafetyReason =
  | 'possible_swelling'
  | 'hive_like_appearance'
  | 'widespread_severe_irritation'
  | 'rapid_worsening'
  | 'eye_area_involvement'
  | 'cracking_or_open_skin_appearance'
  | 'possible_infection_signs';

export const PhotoReferenceQualityStatusValue = {
  GoodReference: 'good_reference',
  LimitedReference: 'limited_reference',
  NotTrendSafe: 'not_trend_safe',
} as const;

export type PhotoReferenceQualityStatus =
  (typeof PhotoReferenceQualityStatusValue)[keyof typeof PhotoReferenceQualityStatusValue];

export type PhotoReferenceQualityReason =
  | 'no_photo'
  | 'analysis_pending'
  | 'analysis_failed'
  | 'analysis_unavailable'
  | 'face_missing'
  | 'needs_retake'
  | 'poor_lighting'
  | 'poor_framing'
  | 'blur'
  | 'quality_limited'
  | 'reaction_day'
  | 'not_comparable';

export interface PhotoReferenceQuality {
  status: PhotoReferenceQualityStatus;
  reasons: PhotoReferenceQualityReason[];
  quality_score: number | null;
}

export interface AnalysisComparisonReference {
  entry_id: string;
  entry_date: string;
  quality: PhotoReferenceQuality;
}

export type AnalysisConcern =
  | 'acne'
  | 'hyperpigmentation'
  | 'redness_inflammation'
  | 'texture'
  | 'oiliness'
  | 'dryness'
  | 'fine_lines'
  | 'skin_barrier_damage'
  | 'eczema_indicator'
  | 'uneven_tone'
  | 'under_eye_darkness'
  | 'large_pores';

export const ANALYSIS_CONCERNS: ReadonlyArray<AnalysisConcern> = [
  'acne',
  'hyperpigmentation',
  'redness_inflammation',
  'texture',
  'oiliness',
  'dryness',
  'fine_lines',
  'skin_barrier_damage',
  'eczema_indicator',
  'uneven_tone',
  'under_eye_darkness',
  'large_pores',
];

export type PhotoFilterKind = 'all' | 'reaction' | 'concern';

export const PHOTO_FILTER_ALL_ID = 'all';
export const PHOTO_FILTER_REACTION_ID = 'reaction';
export const PHOTO_FILTER_CONCERN_PREFIX = 'concern:';

export type ConcernKey =
  | 'oiliness'
  | 'dryness'
  | 'redness'
  | 'breakouts'
  | 'texture'
  | 'irritation'
  | 'sensitivity';

export const CONCERN_KEYS: ReadonlyArray<ConcernKey> = [
  'oiliness',
  'dryness',
  'redness',
  'breakouts',
  'texture',
  'irritation',
  'sensitivity',
];

export type CompareDeltaCode =
  | 'rating_improved'
  | 'rating_worsened'
  | 'reaction_cleared'
  | 'reaction_signal_increased'
  | 'reaction_signal_reduced'
  | 'barrier_signal_worsened'
  | 'barrier_signal_improved'
  | 'photo_concern_improved'
  | 'photo_concern_worsened'
  | 'photo_concern_new'
  | 'photo_concern_cleared'
  | 'not_comparable'
  | 'no_major_change';

export type CompareDeltaSeverity = 'none' | 'mild' | 'moderate' | 'severe';

export interface CompareDeltaBullet {
  code: CompareDeltaCode;
  tone: 'good' | 'warn' | 'neutral';
  concern?: ConcernKey;
  from_rating?: number;
  to_rating?: number;
  analysis_concern?: AnalysisConcern;
  from_severity?: CompareDeltaSeverity;
  to_severity?: CompareDeltaSeverity;
  reason?: PhotoReferenceQualityReason;
  confidence?: number | null;
}

export const SKIN_JOURNAL_LOCAL_DIR = 'uploads/skin-journal';
export const SKIN_JOURNAL_LOCAL_MEDIA_URL_PREFIX = '/api/v1/skin-journal/media';
export const SKIN_JOURNAL_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const SKIN_JOURNAL_PHOTO_MAX_DIMENSION = 1600;
export const SKIN_JOURNAL_PHOTO_WEBP_QUALITY = 85;
export const SKIN_JOURNAL_MEDIA_SIGNED_URL_TTL_SECONDS = 300;
export const SKIN_JOURNAL_EXPORT_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
export const SKIN_JOURNAL_ANALYSIS_TIMEOUT_MS = 180_000;
export const SKIN_JOURNAL_ANALYSIS_MAX_OUTPUT_TOKENS = 24000;
export const SKIN_JOURNAL_ANALYSIS_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const SKIN_JOURNAL_ANALYSIS_MAX_TOTAL_IMAGE_BYTES = 5 * 1024 * 1024;
export const SKIN_JOURNAL_ANALYSIS_MIN_IMAGE_DIMENSION = 180;
export const SKIN_JOURNAL_ANALYSIS_MAX_ASPECT_RATIO = 2.4;
export const SKIN_JOURNAL_ANALYSIS_MIN_LUMA_STANDARD_DEVIATION = 2.5;
export const SKIN_JOURNAL_ANALYSIS_ASSUMED_INPUT_IMAGE_COST_USD = 0.01;
export const SKIN_JOURNAL_ANALYSIS_MAX_REQUEST_COST_USD = 0.5;
export const SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT = 4;
export const SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT_PER_USER = 2;
export const SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD = 3;
export const SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION =
  'skin-journal-photo-v2026-06-14.1';
export const SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: AnalysisQueueDriver =
  'database';
export const SKIN_JOURNAL_ANALYSIS_SQS_WAIT_TIME_SECONDS = 10;
export const SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS = 300;
export const SKIN_JOURNAL_ANALYSIS_JOB_LOCK_TTL_SECONDS = 300;
export const SKIN_JOURNAL_ANALYSIS_JOB_MAX_ATTEMPTS = 5;
export const SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_BASE_SECONDS = 30;
export const SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_MAX_SECONDS = 3600;
export const SKIN_JOURNAL_ANALYSIS_JOB_DISPATCH_INTERVAL_MS = 5000;
export const SKIN_JOURNAL_ANALYSIS_JOB_POLL_INTERVAL_MS = 5000;
export const SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_HEARTBEAT_MS = 60_000;
export const SKIN_JOURNAL_ANALYSIS_RECOVERY_INTERVAL_MS = 60000;
export const SKIN_JOURNAL_ANALYSIS_CAPACITY_RETRY_DELAY_MS = 5000;
export const SKIN_JOURNAL_ANALYSIS_ASSUMED_RUN_COST_USD = 0.03;
export const SKIN_JOURNAL_ANALYSIS_QUEUE_AGE_ALERT_SECONDS = 900;
export const SKIN_JOURNAL_ANALYSIS_FAILURE_RATE_ALERT_THRESHOLD = 0.2;
export const SKIN_JOURNAL_LOCAL_FACE_REJECTION_RATE_ML_REVIEW_THRESHOLD = 0.02;
export const SKIN_JOURNAL_AI_NO_FACE_RATE_ML_REVIEW_THRESHOLD = 0.02;
export const SKIN_JOURNAL_REMINDER_DEFAULT_TIME = '08:00';
export const SKIN_JOURNAL_WRAPPED_MIN_PHOTOS = 3;
export const SKIN_JOURNAL_WRAPPED_ENABLED = false;
export const SKIN_JOURNAL_INSIGHT_PROMPT_VERSION =
  'skin-journal-insights-v2026-05-01.1';
export const SKIN_JOURNAL_INSIGHTS_DEFAULT_MODEL = 'gpt-5.5';
export const SKIN_JOURNAL_INSIGHT_POLISH_TIMEOUT_MS = 45000;
export const SKIN_JOURNAL_INSIGHT_SUMMARY_CARDS_ENABLED = true;
export const SKIN_JOURNAL_INSIGHT_PATTERN_CARDS_ENABLED = true;
export const SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: InsightQueueDriver = 'database';
export const SKIN_JOURNAL_INSIGHT_MIN_ENTRIES_FOR_PERIODIC_GENERATION = 7;
export const SKIN_JOURNAL_INSIGHT_PERIODIC_INTERVAL_DAYS = 7;
export const SKIN_JOURNAL_INSIGHT_FAILED_RETRY_COOLDOWN_DAYS = 1;
export const SKIN_JOURNAL_INSIGHT_SQS_WAIT_TIME_SECONDS = 10;
export const SKIN_JOURNAL_INSIGHT_SQS_VISIBILITY_TIMEOUT_SECONDS = 120;
export const SKIN_JOURNAL_INSIGHT_JOB_LOCK_TTL_SECONDS = 180;
export const SKIN_JOURNAL_INSIGHT_JOB_MAX_ATTEMPTS = 5;
export const SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_BASE_SECONDS = 30;
export const SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_MAX_SECONDS = 3600;
export const SKIN_JOURNAL_INSIGHT_JOB_DISPATCH_INTERVAL_MS = 5000;
export const SKIN_JOURNAL_INSIGHT_JOB_POLL_INTERVAL_MS = 5000;
export const SKIN_JOURNAL_INSIGHT_SQS_VISIBILITY_HEARTBEAT_MS = 45000;
export const SKIN_JOURNAL_PHOTO_PAGE_DEFAULT_LIMIT = 24;
export const SKIN_JOURNAL_PHOTO_PAGE_MAX_LIMIT = 60;
export const SKIN_JOURNAL_MEDIA_DELETION_VERIFY_INTERVAL_MS = 60 * 60 * 1000;
export const SKIN_JOURNAL_MEDIA_DELETION_VERIFY_DELAY_MS = 5 * 60 * 1000;
export const SKIN_JOURNAL_MEDIA_DELETION_VERIFY_MAX_ATTEMPTS = 8;
export const SKIN_JOURNAL_MEDIA_DELETION_VERIFY_BATCH_SIZE = 50;

export interface RatingsPayload {
  oiliness?: 1 | 2 | 3 | 4 | 5;
  dryness?: 1 | 2 | 3 | 4 | 5;
  redness?: 1 | 2 | 3 | 4 | 5;
  breakouts?: 1 | 2 | 3 | 4 | 5;
  texture?: 1 | 2 | 3 | 4 | 5;
  irritation?: 1 | 2 | 3 | 4 | 5;
  sensitivity?: 1 | 2 | 3 | 4 | 5;
}

export interface RecentChangePayload {
  kind: RecentChangeKind;
  related_inventory_product_id?: string | null;
  note?: string | null;
}

export interface ReactionReportPayload {
  symptoms: ReactionReportSymptom[];
  severity: ReactionReportSeverity;
  onset?: ReactionReportOnset | null;
  locations?: ReactionReportLocation[];
  red_flags?: ReactionReportRedFlag[];
  suspected_trigger?: ReactionReportTrigger | null;
  note?: string | null;
}

export interface AnalysisSkinContext {
  skin_type?: string | null;
  skin_tone?: string | null;
  fitzpatrick_phototype?: string | null;
  sensitivity_level?: string | null;
  hydration_level?: string | null;
  current_concerns?: string[];
  concern_details?: Array<{
    concern: string;
    severity?: string | null;
    locations?: string[];
    subtype?: string | null;
    priority?: number | null;
  }>;
}

export interface AnalysisEntryContext {
  entry_date: string;
  ratings?: RatingsPayload | null;
  overall_feel?: OverallFeel | null;
  sleep_band?: SleepBand | null;
  stress_today?: StressLevel | null;
  sun_exposure_today?: SunExposure | null;
  sweat_exercise_today?: boolean | null;
  cycle_marker?: CycleMarker | null;
  recent_change_kind?: RecentChangeKind | null;
  recent_change_product_id?: string | null;
  recent_change_note?: string | null;
  reaction_report?: ReactionReportPayload | null;
  complaint_note?: string | null;
  is_pre_routine?: boolean | null;
}

export interface AnalysisRoutineProductContext {
  product_id: string | null;
  brand: string | null;
  name: string | null;
  category: string | null;
  step_label: string | null;
  preferred_time?: string | null;
  opened_at?: string | null;
  expires_at?: string | null;
  effective_expires_at?: string | null;
  introduction_status?: string | null;
  introduction_started_at?: string | null;
  introduction_status_updated_at?: string | null;
  benefit_tags?: string[];
  suited_for_tags?: string[];
  ingredient_preview?: string[];
  application_method?: string | null;
  quantity?: string | null;
  wait_minutes?: number | null;
  guidance_steps?: string[];
  guidance_cautions?: string[];
  user_product_note?: string | null;
  is_specialist_locked?: boolean;
}

export interface AnalysisRecentApplicationContext {
  target_date: string;
  target_time?: string | null;
  daypart: string | null;
  applied_at: string | null;
  general_notes?: string | null;
  has_been_edited?: boolean;
  items: Array<{
    status: string;
    product_id: string | null;
    brand: string | null;
    name: string | null;
    category: string | null;
    step_label: string | null;
    applied_at?: string | null;
    item_source?: string | null;
    is_ad_hoc?: boolean;
    ad_hoc_brand?: string | null;
    ad_hoc_name?: string | null;
    recommended_product_id?: string | null;
    recommended_brand?: string | null;
    recommended_name?: string | null;
    applied_product_id?: string | null;
    applied_brand?: string | null;
    applied_name?: string | null;
    notes?: string | null;
    substitution_reason?: string | null;
  }>;
}

export interface AnalysisCheckInContext extends AnalysisEntryContext {
  detected_concerns?: AnalysisConcern[];
}

export interface AnalysisRecoveryContext {
  active: boolean;
  simplification_mode: SimplificationMode;
  recovery_phase: RecoveryPhase;
  trigger_source: RecoveryTriggerSource;
  trigger_symptoms: ReactionReportSymptom[];
  trigger_severity: ReactionReportSeverity | null;
  active_overuse: boolean;
  review_after: string | null;
  exit_eligible_at: string | null;
  return_step: RecoveryReturnStep;
  restore_strategy: RestoreStrategy;
}

export interface AnalysisRoutineMemoryContext {
  window: {
    start: string;
    end: string;
    days: number;
  };
  summary: {
    timeline_event_count: number;
    product_change_count: number;
    application_log_count: number;
    reaction_signal_count: number;
    recovery_event_count: number;
    suspicious_product_count: number;
    has_possible_links: boolean;
  };
  suspicious_products: Array<{
    product_id: string;
    brand: string | null;
    name: string | null;
    category: string | null;
    suspicion_level: string;
    score: number;
    reason_codes: string[];
    first_use_date: string | null;
    last_use_date: string | null;
    nearest_reaction_date: string | null;
    days_from_first_use_to_reaction: number | null;
    reaction_signal_count_near_use: number;
  }>;
  recent_events: Array<{
    date: string;
    occurred_at: string | null;
    type: string;
    severity: string;
    source_type: string;
    product_id: string | null;
    brand: string | null;
    name: string | null;
    category: string | null;
  }>;
}

export interface AnalysisRoutineContext {
  active_recovery?: AnalysisRecoveryContext | null;
  routine_memory?: AnalysisRoutineMemoryContext | null;
  active_shelf_products: AnalysisRoutineProductContext[];
  routine_products: AnalysisRoutineProductContext[];
  recent_applications: AnalysisRecentApplicationContext[];
  recent_check_ins: AnalysisCheckInContext[];
}

export interface AnalysisRunMetadata {
  prompt_version: string;
  duration_ms: number;
  input_image_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
}

export interface AnalysisRunResult {
  observations: AnalysisObservations;
  metadata: AnalysisRunMetadata;
}

export const PHOTO_ANALYSIS_GUIDANCE_FACTOR_CODES = [
  'check_in_oiliness',
  'check_in_irritation',
  'check_in_sun',
  'check_in_sweat',
  'check_in_stress',
  'check_in_sleep',
  'check_in_feel',
  'note_diet_acne',
  'recent_product_change',
  'recent_routine_change',
  'routine_product_timing',
  'active_ingredient_timing',
  'sunscreen_context',
  'recent_application_change',
  'acne_common_contributors',
  'pigment_common_contributors',
  'oil_pore_common_contributors',
  'barrier_common_contributors',
  'appearance_common_contributors',
  'general_common_contributors',
] as const;

export type PhotoAnalysisGuidanceFactorCode =
  (typeof PHOTO_ANALYSIS_GUIDANCE_FACTOR_CODES)[number];

export const PHOTO_ANALYSIS_GUIDANCE_ACTION_CODES = [
  'acne_steady_routine',
  'non_comedogenic',
  'log_clusters',
  'spf_context',
  'prevent_irritation',
  'same_light',
  'gentle_cleanse',
  'oil_free_when_possible',
  'watch_shine_pattern',
  'simplify_routine',
  'moisturizer_support',
  'watch_comfort',
  'watch_pattern',
] as const;

export type PhotoAnalysisGuidanceActionCode =
  (typeof PHOTO_ANALYSIS_GUIDANCE_ACTION_CODES)[number];

export const PHOTO_ANALYSIS_GUIDANCE_AVOID_CODES = [
  'multiple_new_actives',
  'picking_or_squeezing',
  'logged_diet_pattern',
  'sweat_friction_after_exercise',
  'pore_clogging_products',
  'inconsistent_spf',
  'irritating_scrubs',
  'stripping_skin',
  'over_exfoliation_for_pores',
  'adding_actives_while_stressed',
  'fragrance_if_sensitive',
  'known_irritant_reexposure',
] as const;

export type PhotoAnalysisGuidanceAvoidCode =
  (typeof PHOTO_ANALYSIS_GUIDANCE_AVOID_CODES)[number];

export interface AnalysisGuidanceDecision {
  concern: AnalysisConcern;
  possible_factor_codes: PhotoAnalysisGuidanceFactorCode[];
  possible_cause_items: string[];
  action_codes: PhotoAnalysisGuidanceActionCode[];
  try_next_items: string[];
  avoid_codes: PhotoAnalysisGuidanceAvoidCode[];
  avoid_items: string[];
  reasoning_summary: string;
}

export interface AnalysisPhotoInput {
  angle: Angle;
  object_key: string;
}

export interface AnalysisAngleQuality {
  angle: Angle;
  face_detected: boolean;
  lighting_quality: 'poor' | 'fair' | 'good' | 'excellent';
  framing_quality: 'poor' | 'fair' | 'good' | 'excellent';
  blur_detected: boolean;
  issues: string[];
  quality_score?: number;
  needs_retake?: boolean;
  used_for_analysis: boolean;
}

export interface AnalysisObservations {
  schema_version: '1.0' | '1.1' | '1.2' | '1.3';
  model_version: string;
  comparison_reference?: AnalysisComparisonReference | null;
  image_quality: {
    face_detected: boolean;
    lighting_quality: 'poor' | 'fair' | 'good' | 'excellent';
    framing_quality: 'poor' | 'fair' | 'good' | 'excellent';
    blur_detected: boolean;
    issues: string[];
    quality_score?: number;
    needs_retake?: boolean;
    excluded_from_trends_reason?: AnalysisTrendExclusionReason | null;
  };
  per_angle_quality?: AnalysisAngleQuality[];
  detected_concerns: Array<{
    concern: AnalysisConcern;
    severity: 'mild' | 'moderate' | 'severe';
    locations: string[];
    confidence: number;
    change_from_previous?: AnalysisChangeDirection;
    change_confidence?: number;
  }>;
  reaction_signals: {
    reaction_detected: boolean;
    reaction_severity: ReactionSeverity;
    indicators: string[];
    confidence: number;
  };
  barrier_signs: {
    barrier_compromise: boolean;
    indicators: string[];
  };
  guidance_decisions?: AnalysisGuidanceDecision[];
  overall_assessment: string;
  overall_change_from_previous?: AnalysisChangeDirection;
  user_visible_message?: string;
  safety_flags?: {
    urgent_review_recommended: boolean;
    doctor_follow_up_recommended: boolean;
    reasons: AnalysisSafetyReason[];
  };
  should_flag_for_doctor: boolean;
  doctor_flag_reason?: string;
}

export type PhotoAnalysisInterpretationCode =
  | 'retake_needed'
  | 'urgent_review'
  | 'professional_review'
  | 'barrier_support'
  | 'acne_progress_timing'
  | 'hyperpigmentation_tracking'
  | 'retinoid_irritation_context'
  | 'stable_baseline';

export interface PhotoAnalysisSourceCitation {
  id: string;
  title_key: string;
  organization: string;
  summary_key: string;
  url: string;
  evidence_grade: Exclude<InsightEvidenceGrade, 'anecdotal'>;
  last_verified: string;
}

export type PhotoAnalysisReadingLabel = 'useful' | 'limited' | 'needs_retake';

export type PhotoAnalysisConcernReadLabel =
  | 'likely_visible'
  | 'possible'
  | 'limited';

export interface PhotoAnalysisTextRef {
  key: string;
  values?: Record<string, string | number>;
}

export interface PhotoAnalysisReadingQuality {
  visual_label: PhotoAnalysisReadingLabel;
  trend_label: PhotoAnalysisReadingLabel;
  reason_keys: PhotoAnalysisTextRef[];
}

export interface PhotoAnalysisConcernGuidance {
  concern: AnalysisConcern;
  severity: 'mild' | 'moderate' | 'severe';
  locations: string[];
  confidence_label: PhotoAnalysisConcernReadLabel;
  title_key: string;
  summary: PhotoAnalysisTextRef;
  possible_factor_keys: PhotoAnalysisTextRef[];
  possible_cause_items?: string[];
  action_keys: PhotoAnalysisTextRef[];
  try_next_items?: string[];
  avoid_keys: PhotoAnalysisTextRef[];
  avoid_items?: string[];
  track_key: PhotoAnalysisTextRef;
  escalation_key?: PhotoAnalysisTextRef | null;
  source_ids: string[];
  sources: PhotoAnalysisSourceCitation[];
}

export interface PhotoAnalysisInterpretation {
  version: '1.0' | '1.1';
  code: PhotoAnalysisInterpretationCode;
  severity: EventSeverity;
  summary_key: string;
  summary_values: Record<string, string | number>;
  guidance_keys: string[];
  caveat_keys: string[];
  source_ids: string[];
  sources: PhotoAnalysisSourceCitation[];
  generated_at: string;
  reading_quality?: PhotoAnalysisReadingQuality;
  concern_guidance?: PhotoAnalysisConcernGuidance[];
}

export interface WrappedManifestEntry {
  entry_id: string;
  entry_date: string;
  caption?: string | null;
  photo_object_key: string;
}

export interface WrappedManifest {
  entries: WrappedManifestEntry[];
  timing: {
    fade_ms: number;
    hold_ms: number;
  };
}

export interface ScheduleSnapshot {
  captured_at: string;
  slots: Array<{
    id: string;
    day_of_week: string;
    slot_time: string;
    mode: string;
    slot_notes: string | null;
    steps: Array<{
      id: string;
      step_order: number;
      step_label: string;
      custom_label: string | null;
      inventory_product_id: string | null;
      notes: string | null;
      optional: boolean;
    }>;
  }>;
}

export type SkinJournalExportEntryRecord = Record<string, unknown> & {
  photo_object_key: string | null;
  photo_url: string | null;
  photos?: Array<{
    angle: Angle;
    photo_object_key: string;
    photo_url: string | null;
    width: number | null;
    height: number | null;
  }>;
};

export type SkinJournalExportPayload = {
  generated_at: string;
  from: string;
  to: string;
  entries: SkinJournalExportEntryRecord[];
  events: Record<string, unknown>[];
  insights: Record<string, unknown>[];
  wrapped: Record<string, unknown>[];
  simplifications: Record<string, unknown>[];
};
