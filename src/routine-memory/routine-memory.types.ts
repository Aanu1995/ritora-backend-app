export const RoutineMemoryEventTypeValue = {
  ProductAdded: 'product_added',
  FirstLoggedUse: 'first_logged_use',
  ProductUsed: 'product_used',
  FrequencyChanged: 'frequency_changed',
  ProductSkipped: 'product_skipped',
  ReactionSignal: 'reaction_signal',
  RecoveryStarted: 'recovery_started',
  RecentChangeLogged: 'recent_change_logged',
} as const;

export type RoutineMemoryEventType =
  (typeof RoutineMemoryEventTypeValue)[keyof typeof RoutineMemoryEventTypeValue];

export const ROUTINE_MEMORY_EVENT_TYPES = Object.values(
  RoutineMemoryEventTypeValue,
);

export const RoutineMemoryEventSeverityValue = {
  Info: 'info',
  Watch: 'watch',
  Warning: 'warning',
  Recovery: 'recovery',
} as const;

export type RoutineMemoryEventSeverity =
  (typeof RoutineMemoryEventSeverityValue)[keyof typeof RoutineMemoryEventSeverityValue];

export const ROUTINE_MEMORY_EVENT_SEVERITIES = Object.values(
  RoutineMemoryEventSeverityValue,
);

export const RoutineMemorySourceTypeValue = {
  InventoryProduct: 'inventory_product',
  ApplicationLog: 'application_log',
  SkinJournalEntry: 'skin_journal_entry',
  RoutineSimplification: 'routine_simplification',
} as const;

export type RoutineMemorySourceType =
  (typeof RoutineMemorySourceTypeValue)[keyof typeof RoutineMemorySourceTypeValue];

export const ROUTINE_MEMORY_SOURCE_TYPES = Object.values(
  RoutineMemorySourceTypeValue,
);

export const RoutineMemorySuspicionLevelValue = {
  Watch: 'watch',
  Possible: 'possible',
  HigherAttention: 'higher_attention',
} as const;

export type RoutineMemorySuspicionLevel =
  (typeof RoutineMemorySuspicionLevelValue)[keyof typeof RoutineMemorySuspicionLevelValue];

export const ROUTINE_MEMORY_SUSPICION_LEVELS = Object.values(
  RoutineMemorySuspicionLevelValue,
);

export const RoutineMemoryReasonCodeValue = {
  ReactionAfterFirstLoggedUse: 'reaction_after_first_logged_use',
  ReactionAfterProductAdded: 'reaction_after_product_added',
  ReactionAfterFrequencyChange: 'reaction_after_frequency_change',
  SkippedAfterReaction: 'skipped_after_reaction',
  ActiveCategoryNearReaction: 'active_category_near_reaction',
} as const;

export type RoutineMemoryReasonCode =
  (typeof RoutineMemoryReasonCodeValue)[keyof typeof RoutineMemoryReasonCodeValue];

export const ROUTINE_MEMORY_REASON_CODES = Object.values(
  RoutineMemoryReasonCodeValue,
);
