export const RoutineReviewDecisionValue = {
  Continue: 'continue',
  Reduce: 'reduce',
  Pause: 'pause',
  Recover: 'recover',
  WaitAndTrack: 'wait_and_track',
  ReviewSpf: 'review_spf',
  SeekProfessionalHelp: 'seek_professional_help',
} as const;

export type RoutineReviewDecision =
  (typeof RoutineReviewDecisionValue)[keyof typeof RoutineReviewDecisionValue];

export const ROUTINE_REVIEW_DECISIONS = Object.values(
  RoutineReviewDecisionValue,
);

export const RoutineReviewRiskLevelValue = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Urgent: 'urgent',
} as const;

export type RoutineReviewRiskLevel =
  (typeof RoutineReviewRiskLevelValue)[keyof typeof RoutineReviewRiskLevelValue];

export const ROUTINE_REVIEW_RISK_LEVELS = Object.values(
  RoutineReviewRiskLevelValue,
);

export const RoutineReviewSignalSeverityValue = {
  Info: 'info',
  Watch: 'watch',
  Warning: 'warning',
  Critical: 'critical',
} as const;

export type RoutineReviewSignalSeverity =
  (typeof RoutineReviewSignalSeverityValue)[keyof typeof RoutineReviewSignalSeverityValue];

export const ROUTINE_REVIEW_SIGNAL_SEVERITIES = Object.values(
  RoutineReviewSignalSeverityValue,
);

export type RoutineReviewReasonCode =
  | 'safety_follow_up'
  | 'active_simplification'
  | 'reaction_or_barrier'
  | 'new_product_reaction'
  | 'active_overuse'
  | 'spf_gap'
  | 'new_product_tracking'
  | 'not_enough_data'
  | 'stable_week';

export type RoutineReviewActionCode =
  | 'seek_professional_help'
  | 'keep_routine_simple'
  | 'pause_strong_actives'
  | 'pause_newest_change'
  | 'reduce_active_frequency'
  | 'review_sunscreen_fit'
  | 'wait_before_changing'
  | 'keep_logging'
  | 'continue_current_routine';

export type RoutineReviewSignalCode =
  | 'doctor_follow_up_flag'
  | 'active_recovery_mode'
  | 'user_reported_reaction'
  | 'reaction_red_flags'
  | 'reaction_signal'
  | 'barrier_signal'
  | 'high_irritation_checkins'
  | 'high_breakout_checkins'
  | 'recent_new_product'
  | 'multiple_recent_products'
  | 'active_heavy_week'
  | 'low_spf_with_pigment_goal'
  | 'limited_tracking_data'
  | 'calm_recent_entries';
