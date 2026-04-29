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
export const SKIN_JOURNAL_REMINDER_DEFAULT_TIME = '08:00';
export const SKIN_JOURNAL_WRAPPED_MIN_PHOTOS = 3;
export const SKIN_JOURNAL_WRAPPED_ENABLED = false;

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

export interface AnalysisObservations {
  schema_version: '1.0';
  model_version: string;
  image_quality: {
    face_detected: boolean;
    lighting_quality: 'poor' | 'fair' | 'good' | 'excellent';
    framing_quality: 'poor' | 'fair' | 'good' | 'excellent';
    blur_detected: boolean;
    issues: string[];
  };
  detected_concerns: Array<{
    concern: string;
    severity: 'mild' | 'moderate' | 'severe';
    locations: string[];
    confidence: number;
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
