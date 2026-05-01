import {
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
  type CycleMarker,
  type OverallFeel,
  type RecentChangeKind,
  type SleepBand,
  type StressLevel,
  type SunExposure,
} from '../skin-journal.constants';

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

function transformOptionalNullableString(params: TransformFnParams): unknown {
  const value = transformValue(params);
  return value === '' ? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class RatingsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) oiliness?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) dryness?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) redness?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) breakouts?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) texture?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  irritation?: number;
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
  @IsOptional() @IsIn(FEELS) overall_feel?: OverallFeel;
  @IsOptional() @IsIn(SLEEP) sleep_band?: SleepBand;
  @IsOptional() @IsIn(STRESS) stress_today?: StressLevel;
  @IsOptional() @IsIn(SUN) sun_exposure_today?: SunExposure;
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean()
  sweat_exercise_today?: boolean;
  @IsOptional() @IsIn(CYCLE) cycle_marker?: CycleMarker;

  @IsOptional()
  @Transform(transformOptionalRecentChange)
  @ValidateNested()
  @Type(() => RecentChangeDto)
  recent_change?: RecentChangeDto | null;

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
}

export const ALL_CONCERN_KEYS = CONCERN_KEYS;
