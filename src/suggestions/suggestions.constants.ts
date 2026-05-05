/**
 * Lifecycle, mode, daypart, and provenance constants shared across the
 * suggestion engine. The frontend mirrors these in
 * `ritora-user-webapp/src/types/suggestions.ts`.
 */

export type SuggestionDaypart = 'morning' | 'noon' | 'evening';
export const SUGGESTION_DAYPARTS: readonly SuggestionDaypart[] = [
  'morning',
  'noon',
  'evening',
] as const;

export type SuggestionMode = 'ai' | 'manual' | 'mixed';
export const SUGGESTION_MODES: readonly SuggestionMode[] = [
  'ai',
  'manual',
  'mixed',
] as const;

export type SuggestionGenerationStatus =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'superseded';

export const SUGGESTION_GENERATION_STATUSES: readonly SuggestionGenerationStatus[] =
  ['pending', 'generating', 'ready', 'failed', 'superseded'] as const;

export type SuggestionSlotLifecycleStatus =
  | 'locked'
  | 'generating'
  | 'ready'
  | 'active'
  | 'recordable'
  | 'recorded'
  | 'edited'
  | 'missed'
  | 'failed';

export const SUGGESTION_SLOT_LIFECYCLE_STATUSES: readonly SuggestionSlotLifecycleStatus[] =
  [
    'locked',
    'generating',
    'ready',
    'active',
    'recordable',
    'recorded',
    'edited',
    'missed',
    'failed',
  ] as const;

export type SuggestionStepProvenance =
  | 'specialist_locked'
  | 'user_routine'
  | 'ai_added';

export const SUGGESTION_STEP_PROVENANCES: readonly SuggestionStepProvenance[] =
  ['specialist_locked', 'user_routine', 'ai_added'] as const;

export type SuggestionGenerationJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SuggestionObservabilityEventKind =
  | 'generation_completed'
  | 'generation_failed'
  | 'generation_fallback'
  | 'job_recovered'
  | 'job_dead_lettered'
  | 'notification_failed'
  | 'safety_rule_rejected'
  | 'ai_budget_blocked'
  | 'consent_degraded'
  | 'retention_purged';

export type SuggestionObservabilitySeverity = 'info' | 'warning' | 'critical';

/**
 * Daypart boundaries used to bucket a slot's time into morning, noon
 * (mid-day), or evening. Matches the mockup naming.
 */
export const DAYPART_BOUNDARY_NOON_MINUTES = 12 * 60;
export const DAYPART_BOUNDARY_EVENING_MINUTES = 18 * 60;

/** Default lead time in minutes the user pref falls back to. */
export const SUGGESTION_LEAD_TIME_DEFAULT_MINUTES = 120;
export const SUGGESTION_LEAD_TIME_MIN_MINUTES = 30;
export const SUGGESTION_LEAD_TIME_MAX_MINUTES = 720;

/** Polling cadence for the generation worker, in milliseconds. */
export const SUGGESTION_GENERATION_POLL_INTERVAL_MS = 10_000;
/** Attempts before a generation job is permanently failed. */
export const SUGGESTION_GENERATION_MAX_ATTEMPTS = 3;
/** Running jobs older than this are reset or dead-lettered. */
export const SUGGESTION_JOB_LOCK_TIMEOUT_MINUTES = 15;
/** Number of stale running jobs the worker reaps per poll. */
export const SUGGESTION_STALE_JOB_REAPER_BATCH_SIZE = 25;
/** Window during which the scheduler enqueues upcoming suggestion jobs. */
export const SUGGESTION_SCHEDULER_LOOKAHEAD_HOURS = 26;
/** Cadence at which the scheduler scans for new jobs to enqueue. */
export const SUGGESTION_SCHEDULER_INTERVAL_MS = 60_000;
/** Scheduler page size to avoid unbounded schedule-slot scans. */
export const SUGGESTION_SCHEDULER_BATCH_SIZE = 500;

/**
 * Recording reminder cadence. Mockup 13 shows a reminder thirty minutes
 * after slot start if the user has not recorded yet, with another at the
 * next slot boundary the following morning.
 */
export const RECORDING_REMINDER_DELAY_MINUTES = 30;
export const RECORDING_REMINDER_RETRY_NEXT_MORNING_HOURS = 8;

/** Identifies the prompt schema in case we change it later. */
export const SUGGESTION_PROMPT_VERSION = '2026-05-03.v1';
export const SUGGESTION_AI_CONSENT_VERSION = '2026-05-04.v1';
/** Identifies deterministic rule governance used around AI output. */
export const SUGGESTION_SAFETY_POLICY_VERSION = '2026-05-04.production.v1';
export const SUGGESTION_SAFETY_POLICY_REVIEWED_AT = '2026-05-04';

/** AI cost and abuse guardrails. Kept in code for predictable behavior. */
export const SUGGESTION_AI_DAILY_USER_GENERATION_LIMIT = 12;
export const SUGGESTION_AI_DAILY_USER_REGENERATION_LIMIT = 4;
export const SUGGESTION_AI_DAILY_USER_COST_LIMIT_USD = 1.5;

/** Sensitive cache/context retention windows. */
export const SUGGESTION_CONTEXT_CACHE_RETENTION_DAYS = 30;
export const SUGGESTION_GENERATION_CONTEXT_RETENTION_DAYS = 90;
export const SUGGESTION_RETENTION_INITIAL_DELAY_MS = 5 * 60 * 1000;
export const SUGGESTION_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT = 10;
export const SUGGESTION_HISTORY_PAGE_MAX_LIMIT = 50;
export const SUGGESTION_HISTORY_EXPORT_MAX_ROWS = 5000;

export enum SuggestionEvidenceSourceId {
  AadSunscreenSelection = 'aad_sunscreen_selection',
  AadRetinoidRetinol = 'aad_retinoid_retinol',
  AadAcneTreatment = 'aad_acne_treatment',
  FdaAhaSunSensitivity = 'fda_aha_sun_sensitivity',
  MayoDrySkinCare = 'mayo_dry_skin_care',
  DermNetTopicalRetinoids = 'dermnet_topical_retinoids',
}

export interface SuggestionEvidenceSourceJson {
  id: SuggestionEvidenceSourceId;
  title: string;
  organization: string;
  url: string;
  evidenceType:
    | 'dermatology_association'
    | 'regulatory_guidance'
    | 'clinical_reference';
  summary: string;
  reviewedAt: string;
}

export interface SuggestionExplanationJson {
  headline: string;
  body: string[];
  perStepReasons: { stepOrder: number; reason: string }[];
  skipped: { name: string; reason: string }[];
  inputs: { label: string; detail: string }[];
}

export interface SuggestionGapRecommendationJson {
  ingredientOrCategory: string;
  reason: string;
  budgetTier: 'starter' | 'mid' | 'premium' | null;
  goalAlignment: string | null;
  sourceIds: SuggestionEvidenceSourceId[];
}

export type SuggestionGapActionKind = 'saved' | 'dismissed';
export const SUGGESTION_GAP_ACTION_KINDS: readonly SuggestionGapActionKind[] = [
  'saved',
  'dismissed',
] as const;

export type SuggestionGapRecommendationResponseJson =
  SuggestionGapRecommendationJson & {
    userAction?: SuggestionGapActionKind | null;
  };

export type SuggestionReactionOverrideReason = 'normal_routine_requested';
export const SUGGESTION_REACTION_OVERRIDE_REASONS: readonly SuggestionReactionOverrideReason[] =
  ['normal_routine_requested'] as const;

export interface SuggestionSafetyFlagJson {
  severity: 'info' | 'warning' | 'critical';
  message: string;
  ingredientSlugs: string[];
  sourceIds: SuggestionEvidenceSourceId[];
}

export interface SuggestionStepChipJson {
  tone: 'neutral' | 'reason' | 'ai' | 'specialist' | 'warn';
  text: string;
}
