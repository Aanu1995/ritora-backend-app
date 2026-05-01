export type Angle = 'head_on' | 'left_profile' | 'right_profile';

export type AnalysisStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'needs_review'
  | 'skipped';

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
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'trend'
  | 'correlation'
  | 'effectiveness'
  | 'reaction_recovery'
  | 'referral';

export type WrappedPeriodKind = 'monthly' | 'quarterly' | 'yearly';

export type WrappedStatus =
  | 'not_enough_photos'
  | 'ready_to_generate'
  | 'pending'
  | 'generating'
  | 'ready'
  | 'failed';

export type SimplificationMode = 'barrier_repair';

export type RestoreStrategy = 'full' | 'phased';

export type ReactionSeverity = 'none' | 'mild' | 'moderate' | 'severe';

export type ExportStatus = 'ready' | 'failed';

export type AnalysisJobStatus =
  | 'queued'
  | 'sent'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AnalysisQueueDriver = 'sqs' | 'database';

export type MediaDeletionJobStatus = 'pending' | 'verified' | 'failed';

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
  | 'no_major_change';

export interface CompareDeltaBullet {
  code: CompareDeltaCode;
  tone: 'good' | 'warn' | 'neutral';
  concern?: ConcernKey;
  from_rating?: number;
  to_rating?: number;
}

export const SKIN_JOURNAL_LOCAL_DIR = 'uploads/skin-journal';
export const SKIN_JOURNAL_LOCAL_MEDIA_URL_PREFIX = '/api/v1/skin-journal/media';
export const SKIN_JOURNAL_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const SKIN_JOURNAL_PHOTO_MAX_DIMENSION = 1600;
export const SKIN_JOURNAL_PHOTO_WEBP_QUALITY = 85;
export const SKIN_JOURNAL_MEDIA_SIGNED_URL_TTL_SECONDS = 300;
export const SKIN_JOURNAL_EXPORT_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
export const SKIN_JOURNAL_ANALYSIS_TIMEOUT_MS = 45000;
export const SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT = 4;
export const SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT_PER_USER = 2;
export const SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD = 1;
export const SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION =
  'skin-journal-photo-v2026-04-30.1';
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
export const SKIN_JOURNAL_REMINDER_DEFAULT_TIME = '08:00';
export const SKIN_JOURNAL_WRAPPED_MIN_PHOTOS = 3;
export const SKIN_JOURNAL_WRAPPED_ENABLED = false;
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

export interface AnalysisObservations {
  schema_version: '1.0' | '1.1';
  model_version: string;
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
