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

export type ReactionSeverity = 'none' | 'mild' | 'moderate' | 'severe';

export const ExportStatusValue = {
  Ready: 'ready',
  Failed: 'failed',
} as const;

export type ExportStatus =
  (typeof ExportStatusValue)[keyof typeof ExportStatusValue];

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
export const SKIN_JOURNAL_ANALYSIS_TIMEOUT_MS = 45000;
export const SKIN_JOURNAL_ANALYSIS_MAX_OUTPUT_TOKENS = 1600;
export const SKIN_JOURNAL_ANALYSIS_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const SKIN_JOURNAL_ANALYSIS_MAX_TOTAL_IMAGE_BYTES = 5 * 1024 * 1024;
export const SKIN_JOURNAL_ANALYSIS_MIN_IMAGE_DIMENSION = 180;
export const SKIN_JOURNAL_ANALYSIS_MAX_ASPECT_RATIO = 2.4;
export const SKIN_JOURNAL_ANALYSIS_MIN_LUMA_STANDARD_DEVIATION = 2.5;
export const SKIN_JOURNAL_ANALYSIS_ASSUMED_INPUT_IMAGE_COST_USD = 0.01;
export const SKIN_JOURNAL_ANALYSIS_MAX_REQUEST_COST_USD = 0.08;
export const SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT = 4;
export const SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT_PER_USER = 2;
export const SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD = 1;
export const SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION =
  'skin-journal-photo-v2026-05-16.1';
export const SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: AnalysisQueueDriver =
  'database';
export const SKIN_JOURNAL_ANALYSIS_SQS_WAIT_TIME_SECONDS = 10;
export const SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS = 120;
export const SKIN_JOURNAL_ANALYSIS_JOB_LOCK_TTL_SECONDS = 180;
export const SKIN_JOURNAL_ANALYSIS_JOB_MAX_ATTEMPTS = 5;
export const SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_BASE_SECONDS = 30;
export const SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_MAX_SECONDS = 3600;
export const SKIN_JOURNAL_ANALYSIS_JOB_DISPATCH_INTERVAL_MS = 5000;
export const SKIN_JOURNAL_ANALYSIS_JOB_POLL_INTERVAL_MS = 5000;
export const SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_HEARTBEAT_MS = 45000;
export const SKIN_JOURNAL_ANALYSIS_RECOVERY_INTERVAL_MS = 60000;
export const SKIN_JOURNAL_ANALYSIS_CAPACITY_RETRY_DELAY_MS = 5000;
export const SKIN_JOURNAL_ANALYSIS_ASSUMED_RUN_COST_USD = 0.01;
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
  complaint_note?: string | null;
  is_pre_routine?: boolean | null;
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
  schema_version: '1.0' | '1.1' | '1.2';
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

export interface PhotoAnalysisInterpretation {
  version: '1.0';
  code: PhotoAnalysisInterpretationCode;
  severity: EventSeverity;
  summary_key: string;
  summary_values: Record<string, string | number>;
  guidance_keys: string[];
  caveat_keys: string[];
  source_ids: string[];
  sources: PhotoAnalysisSourceCitation[];
  generated_at: string;
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
