import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  plainToInstance,
  Transform,
  Type,
  type TransformFnParams,
} from 'class-transformer';
import {
  CONCERN_KEYS,
  REACTION_REPORT_LOCATIONS,
  REACTION_REPORT_ONSETS,
  REACTION_REPORT_RED_FLAGS,
  REACTION_REPORT_SEVERITIES,
  REACTION_REPORT_SYMPTOMS,
  REACTION_REPORT_TRIGGERS,
  SKIN_JOURNAL_PHOTO_ANGLES,
  type Angle,
  type CycleMarker,
  type OverallFeel,
  type ReactionReportLocation,
  type ReactionReportOnset,
  type ReactionReportRedFlag,
  type ReactionReportSeverity,
  type ReactionReportSymptom,
  type ReactionReportTrigger,
  type RecentChangeKind,
  type SleepBand,
  type StressLevel,
  type SunExposure,
} from '../skin-journal.constants';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

const FEELS: OverallFeel[] = ['awful', 'bad', 'ok', 'good', 'great'];
const SLEEP: SleepBand[] = ['lt5h', '5to7h', '7to9h', 'gt9h', 'skipped'];
const STRESS: StressLevel[] = ['low', 'mid', 'high'];
const SUN: SunExposure[] = ['none', 'brief', 'lots'];
const CYCLE: CycleMarker[] = [
  'not_on',
  'day_1_3',
  'day_4_7',
  'late_cycle',
  'dont_track',
];
const CHANGE_KINDS: RecentChangeKind[] = [
  'started_new_product',
  'stopped_a_product',
  'changed_frequency',
  'got_a_treatment',
  'felt_unwell',
  'travelled',
  'other',
];

const INVALID_JSON_OBJECT: Record<string, true> = {
  __invalid_json_payload__: true,
};

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function transformValue(params: TransformFnParams): unknown {
  return (params as { value: unknown }).value;
}

function transformOptionalBoolean(params: TransformFnParams): unknown {
  const value = transformValue(params);
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

function transformOptionalJsonArray(params: TransformFnParams): unknown {
  const value = transformValue(params);
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    return value;
  }
  return parseJsonString(value) ?? value;
}

function parseOptionalJsonObjectValue(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const parsed = parseJsonString(value);
  return parsed ?? { ...INVALID_JSON_OBJECT };
}

function parseOptionalNullableJsonObjectValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const parsed = parseJsonString(value);
  return parsed ?? { ...INVALID_JSON_OBJECT };
}

function transformOptionalRatings(params: TransformFnParams): unknown {
  const value = parseOptionalJsonObjectValue(params.value);
  return isRecord(value) ? plainToInstance(RatingsDto, value) : value;
}

function transformOptionalRecentChange(params: TransformFnParams): unknown {
  const value = parseOptionalNullableJsonObjectValue(params.value);
  return isRecord(value) ? plainToInstance(RecentChangeDto, value) : value;
}

function transformOptionalReactionReport(params: TransformFnParams): unknown {
  const value = parseOptionalNullableJsonObjectValue(params.value);
  return isRecord(value) ? plainToInstance(ReactionReportDto, value) : value;
}

function transformOptionalNullableString(params: TransformFnParams): unknown {
  const value = transformValue(params);
  return value === '' ? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class RatingsDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  oiliness?: number;

  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  dryness?: number;

  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  redness?: number;

  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  breakouts?: number;

  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  texture?: number;

  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  irritation?: number;

  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  sensitivity?: number;
}

export class RecentChangeDto {
  @IsIn(CHANGE_KINDS) kind: RecentChangeKind;
  @IsOptional() @IsString() related_inventory_product_id?: string | null;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class ReactionReportDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(REACTION_REPORT_SYMPTOMS, { each: true })
  symptoms: ReactionReportSymptom[];

  @IsIn(REACTION_REPORT_SEVERITIES)
  severity: ReactionReportSeverity;

  @IsOptional()
  @IsIn(REACTION_REPORT_ONSETS)
  onset?: ReactionReportOnset | null;

  @IsOptional()
  @IsArray()
  @IsIn(REACTION_REPORT_LOCATIONS, { each: true })
  locations?: ReactionReportLocation[];

  @IsOptional()
  @IsArray()
  @IsIn(REACTION_REPORT_RED_FLAGS, { each: true })
  red_flags?: ReactionReportRedFlag[];

  @IsOptional()
  @IsIn(REACTION_REPORT_TRIGGERS)
  suspected_trigger?: ReactionReportTrigger | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UpsertEntryDto {
  @IsOptional()
  @Transform(transformOptionalJsonArray)
  @IsArray()
  @IsString({ each: true })
  concern_focus?: string[];

  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  is_pre_routine?: boolean;

  @IsOptional()
  @Transform(transformOptionalRatings)
  @ValidateNested()
  @Type(() => RatingsDto)
  ratings?: RatingsDto;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(FEELS)
  overall_feel?: OverallFeel;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(SLEEP)
  sleep_band?: SleepBand;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(STRESS)
  stress_today?: StressLevel;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(SUN)
  sun_exposure_today?: SunExposure;

  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  sweat_exercise_today?: boolean;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(CYCLE)
  cycle_marker?: CycleMarker;

  @IsOptional()
  @Transform(transformOptionalRecentChange)
  @ValidateNested()
  @Type(() => RecentChangeDto)
  recent_change?: RecentChangeDto | null;

  @IsOptional()
  @Transform(transformOptionalReactionReport)
  @ValidateNested()
  @Type(() => ReactionReportDto)
  reaction_report?: ReactionReportDto | null;

  @IsOptional()
  @Transform(transformOptionalNullableString)
  @IsString()
  @MaxLength(2000)
  complaint_note?: string | null;

  /** When set, server will skip running analysis (use for "save photo only"). */
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  skip_check_in?: boolean;

  /** Explicit consent gate for first skin-progress photo processing. */
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  photo_processing_consent?: boolean;

  @IsOptional()
  @Transform(transformOptionalJsonArray)
  @IsArray()
  @IsIn(SKIN_JOURNAL_PHOTO_ANGLES, { each: true })
  remove_photo_angles?: Angle[];
}

export const ALL_CONCERN_KEYS = CONCERN_KEYS;
