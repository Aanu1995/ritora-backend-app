export const NOTIFICATION_PAGE_DEFAULT_LIMIT = 20;
export const NOTIFICATION_PAGE_MAX_LIMIT = 30;
export const NOTIFICATION_READ_RETENTION_DAYS = 90;
export const NOTIFICATION_SAFETY_READ_RETENTION_DAYS = 365;
export const NOTIFICATION_RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const PRODUCT_EXPIRY_NOTICE_DAYS_MIN = 1;
export const PRODUCT_EXPIRY_NOTICE_DAYS_MAX = 90;
export const PRODUCT_EXPIRY_NOTICE_DAYS_DEFAULT = 14;
export const PRODUCT_EXPIRY_SWEEP_BATCH_SIZE = 500;

export const InsightCadenceValue = {
  Weekly: 'weekly',
  Fewer: 'fewer',
} as const;

export type InsightCadence =
  (typeof InsightCadenceValue)[keyof typeof InsightCadenceValue];

export const INSIGHT_CADENCE_VALUES = Object.values(InsightCadenceValue);
export const INSIGHT_CADENCE_DEFAULT: InsightCadence =
  InsightCadenceValue.Weekly;
export const INSIGHT_DIGEST_DAY_MIN = 1;
export const INSIGHT_DIGEST_DAY_MAX = 7;
export const INSIGHT_DIGEST_DAY_DEFAULT = 1;
export const INSIGHT_DIGEST_LOCAL_TIME_DEFAULT = '09:00';
export const INSIGHT_CADENCE_INTERVAL_DAYS: Record<InsightCadence, number> = {
  [InsightCadenceValue.Weekly]: 7,
  [InsightCadenceValue.Fewer]: 21,
};
