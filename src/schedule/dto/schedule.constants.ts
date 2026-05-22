import { ProductCategory } from '../../shelf/shelf.types';

export const DAYS_OF_WEEK = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const SlotModeValue = {
  Manual: 'manual',
  Ai: 'ai',
} as const;

export const SLOT_MODES = Object.values(SlotModeValue);
export type SlotMode = (typeof SLOT_MODES)[number];
export const DEFAULT_SLOT_MODE: SlotMode = SlotModeValue.Ai;

export const STEP_LABELS = [
  ...Object.values(ProductCategory),
  'custom',
] as const;
export type StepLabel = (typeof STEP_LABELS)[number];
export const CUSTOM_STEP_LABEL: StepLabel = 'custom';

export const SCHEDULE_PRESETS = ['every_day'] as const;
export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number];

export const MAX_STEPS_PER_SLOT = 10;
export const MAX_SLOT_NOTES_LENGTH = 1000;
export const MAX_STEP_NOTES_LENGTH = 500;
export const MAX_CUSTOM_LABEL_LENGTH = 100;
export const MAX_SPECIALIST_PROVIDER_NAME_LENGTH = 120;
export const MAX_SPECIALIST_CLINIC_NAME_LENGTH = 160;
export const MAX_SPECIALIST_SAFETY_NOTES_LENGTH = 1000;

export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
