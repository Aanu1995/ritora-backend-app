export const SuggestionDaypart = {
  Morning: 'morning',
  Noon: 'noon',
  Evening: 'evening',
} as const;

export type SuggestionDaypart =
  (typeof SuggestionDaypart)[keyof typeof SuggestionDaypart];

export const SUGGESTION_DAYPARTS = Object.values(SuggestionDaypart);

export const SuggestionMode = {
  Ai: 'ai',
  Manual: 'manual',
  Mixed: 'mixed',
} as const;

export type SuggestionMode =
  (typeof SuggestionMode)[keyof typeof SuggestionMode];

export const SUGGESTION_MODES = Object.values(SuggestionMode);

export const SuggestionGenerationStatus = {
  Pending: 'pending',
  Generating: 'generating',
  Ready: 'ready',
  Failed: 'failed',
  Superseded: 'superseded',
} as const;

export type SuggestionGenerationStatus =
  (typeof SuggestionGenerationStatus)[keyof typeof SuggestionGenerationStatus];

export const SUGGESTION_GENERATION_STATUSES = Object.values(
  SuggestionGenerationStatus,
);

export const SuggestionSlotLifecycleStatus = {
  Locked: 'locked',
  Generating: 'generating',
  Ready: 'ready',
  Active: 'active',
  Recordable: 'recordable',
  Recorded: 'recorded',
  Edited: 'edited',
  Missed: 'missed',
  Failed: 'failed',
} as const;

export type SuggestionSlotLifecycleStatus =
  (typeof SuggestionSlotLifecycleStatus)[keyof typeof SuggestionSlotLifecycleStatus];

export const SUGGESTION_SLOT_LIFECYCLE_STATUSES = Object.values(
  SuggestionSlotLifecycleStatus,
);

export const SuggestionStepProvenance = {
  SpecialistLocked: 'specialist_locked',
  UserRoutine: 'user_routine',
  AiAdded: 'ai_added',
} as const;

export type SuggestionStepProvenance =
  (typeof SuggestionStepProvenance)[keyof typeof SuggestionStepProvenance];

export const SUGGESTION_STEP_PROVENANCES = Object.values(
  SuggestionStepProvenance,
);

export const SuggestionGenerationJobStatus = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;

export type SuggestionGenerationJobStatus =
  (typeof SuggestionGenerationJobStatus)[keyof typeof SuggestionGenerationJobStatus];

export const SuggestionRequestSource = {
  Scheduled: 'scheduled',
  OnDemand: 'on_demand',
} as const;

export type SuggestionRequestSource =
  (typeof SuggestionRequestSource)[keyof typeof SuggestionRequestSource];

export const SUGGESTION_REQUEST_SOURCES = Object.values(
  SuggestionRequestSource,
);

export const SuggestionHistoryRange = {
  SevenDays: '7d',
  ThirtyDays: '30d',
  Custom: 'custom',
} as const;

export type SuggestionHistoryRange =
  (typeof SuggestionHistoryRange)[keyof typeof SuggestionHistoryRange];

export const SUGGESTION_HISTORY_RANGES = Object.values(SuggestionHistoryRange);

export const SuggestionHistorySlotStatus = {
  Applied: 'applied',
  Partial: 'partial',
  Skipped: 'skipped',
  Simplified: 'simplified',
  Missed: 'missed',
} as const;

export type SuggestionHistorySlotStatus =
  (typeof SuggestionHistorySlotStatus)[keyof typeof SuggestionHistorySlotStatus];

export const SUGGESTION_HISTORY_SLOT_STATUSES = Object.values(
  SuggestionHistorySlotStatus,
);

export const SuggestionRegenerationReason = {
  UserRequested: 'user_requested',
  ScheduleChange: 'schedule_change',
  ReactionDetected: 'reaction_detected',
  NormalRoutineRequested: 'normal_routine_requested',
} as const;

export type SuggestionRegenerationReason =
  (typeof SuggestionRegenerationReason)[keyof typeof SuggestionRegenerationReason];

export const SUGGESTION_REGENERATION_REASONS = Object.values(
  SuggestionRegenerationReason,
);

export type OnDemandSuggestionIntent =
  | 'post_workout'
  | 'post_sun'
  | 'post_swim'
  | 'travel_refresh'
  | 'quick_refresh'
  | 'event_prep'
  | 'post_makeup_or_shower'
  | 'other';

export const ON_DEMAND_SUGGESTION_INTENTS: readonly OnDemandSuggestionIntent[] =
  [
    'post_workout',
    'post_sun',
    'post_swim',
    'travel_refresh',
    'quick_refresh',
    'event_prep',
    'post_makeup_or_shower',
    'other',
  ] as const;

export type OnDemandSuggestionIntensity = 'minimal' | 'standard';
export const ON_DEMAND_SUGGESTION_INTENSITIES: readonly OnDemandSuggestionIntensity[] =
  ['minimal', 'standard'] as const;

export interface SuggestionRequestContextJson {
  intent: OnDemandSuggestionIntent;
  intensity: OnDemandSuggestionIntensity;
  note: string | null;
  activityAt: string | null;
  requestedAt: string;
}

export type SuggestionObservabilityEventKind =
  | 'on_demand_requested'
  | 'on_demand_duplicate_request'
  | 'on_demand_retry_requested'
  | 'generation_completed'
  | 'generation_context_loaded'
  | 'generation_context_threshold_exceeded'
  | 'generation_failed'
  | 'generation_fallback'
  | 'job_recovered'
  | 'job_dead_lettered'
  | 'notification_failed'
  | 'safety_rule_rejected'
  | 'ai_budget_blocked'
  | 'consent_degraded'
  | 'smart_pick_generation_completed'
  | 'smart_pick_generation_degraded'
  | 'smart_pick_ai_failed'
  | 'smart_pick_no_pick'
  | 'smart_pick_quality_drift'
  | 'smart_pick_unsafe_output_blocked'
  | 'smart_pick_user_feedback'
  | 'retention_purged';

export type SuggestionObservabilitySeverity = 'info' | 'warning' | 'critical';

export const DAYPART_BOUNDARY_NOON_MINUTES = 12 * 60;
export const DAYPART_BOUNDARY_EVENING_MINUTES = 18 * 60;

export const SUGGESTION_LEAD_TIME_DEFAULT_MINUTES = 120;
export const SUGGESTION_LEAD_TIME_MIN_MINUTES = 30;
export const SUGGESTION_LEAD_TIME_MAX_MINUTES = 720;

export const SUGGESTION_GENERATION_POLL_INTERVAL_MS = 10_000;
export const SUGGESTION_GENERATION_MAX_ATTEMPTS = 3;
export const SUGGESTION_JOB_LOCK_TIMEOUT_MINUTES = 15;
export const SUGGESTION_STALE_JOB_REAPER_BATCH_SIZE = 25;
export const SUGGESTION_SCHEDULER_LOOKAHEAD_HOURS = 26;
export const SUGGESTION_SCHEDULER_INTERVAL_MS = 60_000;
export const SUGGESTION_SCHEDULER_BATCH_SIZE = 500;

export const RECORDING_REMINDER_DELAY_MINUTES = 30;
export const RECORDING_REMINDER_RETRY_NEXT_MORNING_HOURS = 8;

export const SUGGESTION_PROMPT_VERSION = '2026-06-28.v18-agentic-clarity';
export const SUGGESTION_AI_CONSENT_VERSION = '2026-05-04.v1';
export const SUGGESTION_SAFETY_POLICY_VERSION = '2026-06-23.production.v3';
export const SUGGESTION_SAFETY_POLICY_REVIEWED_AT = '2026-05-04';

export const SUGGESTION_AI_DAILY_USER_GENERATION_LIMIT = 12;
export const SUGGESTION_AI_DAILY_USER_REGENERATION_LIMIT = 4;
export const SUGGESTION_AI_DAILY_USER_COST_LIMIT_USD = 1.5;
export const SUGGESTION_ON_DEMAND_DAILY_USER_LIMIT = 5;
export const SUGGESTION_ON_DEMAND_COOLDOWN_MINUTES = 2;
export const SUGGESTION_CONSERVATIVE_RESTART_AFTER_DAYS = 14;
export const SUGGESTION_REACTION_SKIP_PAUSE_DAYS = 3;

export const SUGGESTION_CONTEXT_CACHE_RETENTION_DAYS = 30;
export const SUGGESTION_GENERATION_CONTEXT_RETENTION_DAYS = 90;
export const SUGGESTION_RETENTION_INITIAL_DELAY_MS = 5 * 60 * 1000;
export const SUGGESTION_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT = 20;
export const SUGGESTION_HISTORY_PAGE_MAX_LIMIT = 50;

export enum SuggestionEvidenceSourceId {
  AadSunscreenSelection = 'aad_sunscreen_selection',
  AadRetinoidRetinol = 'aad_retinoid_retinol',
  AadAcneTreatment = 'aad_acne_treatment',
  AadMelasmaTreatment = 'aad_melasma_treatment',
  DermNetPostInflammatoryHyperpigmentation = 'dermnet_post_inflammatory_hyperpigmentation',
  FdaAhaSunSensitivity = 'fda_aha_sun_sensitivity',
  MayoDrySkinCare = 'mayo_dry_skin_care',
  DermNetTopicalRetinoids = 'dermnet_topical_retinoids',
  NationalEczemaSocietyHardWater = 'national_eczema_society_hard_water',
  OpenMeteoWeather = 'open_meteo_weather',
  OpenMeteoAirQuality = 'open_meteo_air_quality',
  OpenMeteoSeasonalForecast = 'open_meteo_seasonal_forecast',
}

export interface SuggestionEvidenceSourceJson {
  id: SuggestionEvidenceSourceId;
  title: string;
  organization: string;
  url: string;
  evidenceType:
    | 'dermatology_association'
    | 'regulatory_guidance'
    | 'clinical_reference'
    | 'environmental_data_provider';
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

export type RoutineBreakStatus = 'active' | 'resumed';
export const ROUTINE_BREAK_STATUSES: readonly RoutineBreakStatus[] = [
  'active',
  'resumed',
] as const;

export type RoutineBreakViewStatus = 'active' | 'upcoming';
export const ROUTINE_BREAK_VIEW_STATUSES: readonly RoutineBreakViewStatus[] = [
  'active',
  'upcoming',
] as const;

export const ROUTINE_BREAK_ACTIVE_MESSAGE =
  'Your routine is paused. Ritora will not generate new skincare suggestions until you resume.';
export const ROUTINE_BREAK_NOTIFICATION_CANCEL_REASON = 'routine_break_active';
export const ROUTINE_BREAK_SUPPRESSED_JOB_REASON = 'routine_break_active';
export const ROUTINE_BREAK_NOTIFICATION_KINDS = [
  'suggestion_ready',
  'slot_start',
  'recording_reminder',
] as const;

export interface SuggestionSafetyFlagJson {
  severity: 'info' | 'warning' | 'critical';
  message: string;
  ingredientSlugs: string[];
  sourceIds: SuggestionEvidenceSourceId[];
}

export interface SuggestionStepChipJson {
  tone: SuggestionStepChipTone;
  text: string;
}

export const SuggestionStepChipTone = {
  Neutral: 'neutral',
  Reason: 'reason',
  Ai: 'ai',
  Specialist: 'specialist',
  Warn: 'warn',
} as const;

export type SuggestionStepChipTone =
  (typeof SuggestionStepChipTone)[keyof typeof SuggestionStepChipTone];

export const SUGGESTION_STEP_CHIP_TONES = Object.values(SuggestionStepChipTone);
