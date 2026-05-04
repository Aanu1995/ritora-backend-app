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
/** Window during which the scheduler enqueues upcoming suggestion jobs. */
export const SUGGESTION_SCHEDULER_LOOKAHEAD_HOURS = 26;
/** Cadence at which the scheduler scans for new jobs to enqueue. */
export const SUGGESTION_SCHEDULER_INTERVAL_MS = 60_000;

/**
 * Recording reminder cadence. Mockup 13 shows a reminder thirty minutes
 * after slot start if the user has not recorded yet, with another at the
 * next slot boundary the following morning.
 */
export const RECORDING_REMINDER_DELAY_MINUTES = 30;
export const RECORDING_REMINDER_RETRY_NEXT_MORNING_HOURS = 8;

/** Identifies the prompt schema in case we change it later. */
export const SUGGESTION_PROMPT_VERSION = '2026-05-03.v1';

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
}

export interface SuggestionSafetyFlagJson {
  severity: 'info' | 'warning' | 'critical';
  message: string;
  ingredientSlugs: string[];
}

export interface SuggestionStepChipJson {
  tone: 'neutral' | 'reason' | 'ai' | 'specialist' | 'warn';
  text: string;
}
