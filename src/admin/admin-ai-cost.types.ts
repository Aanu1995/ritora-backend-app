export const AdminAiCostFeatureFilter = {
  All: 'all',
  DailySuggestions: 'daily_suggestions',
  JournalAnalysis: 'journal_analysis',
  JournalInsights: 'journal_insights',
  QuickCheck: 'quick_check',
  SmartPicks: 'smart_picks',
} as const;

export type AdminAiCostFeatureFilter =
  (typeof AdminAiCostFeatureFilter)[keyof typeof AdminAiCostFeatureFilter];

export const AdminAiCostPeriod = {
  MonthToDate: 'month_to_date',
  Today: 'today',
} as const;

export type AdminAiCostPeriod =
  (typeof AdminAiCostPeriod)[keyof typeof AdminAiCostPeriod];
