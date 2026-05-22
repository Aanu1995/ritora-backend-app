import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ACTIVE_TOLERANCE_LEVELS,
  ALCOHOL_LEVELS,
  BUDGET_TIERS,
  CLIMATE_SENSITIVITIES,
  CYCLE_PATTERNS,
  DIET_FLAGS,
  ETHNICITIES,
  FITZPATRICK_PHOTOTYPES,
  HORMONAL_BREAKOUT_PATTERNS,
  HYDRATION_LEVELS,
  INGREDIENT_ETHICS,
  PREGNANCY_STATUSES,
  PROCEDURE_TYPES,
  REACTION_CERTAINTIES,
  REACTION_SEVERITIES,
  REACTION_TRIGGER_TYPES,
  REACTION_TYPES,
  ROUTINE_PACES,
  SENSITIVITY_LEVELS,
  SEX_AT_BIRTH,
  SKIN_CONCERNS,
  SKIN_CONDITIONS,
  SKIN_MEDICATIONS,
  SKIN_TONES,
  SKIN_TYPES,
  SLEEP_LEVELS,
  SMOKING_LEVELS,
  STRESS_LEVELS,
  SUNSCREEN_FILTERS,
  SUNSCREEN_FINISHES,
  SUNSCREEN_HABITS,
  SUNSCREEN_TOLERANCES,
  TENDENCY_LEVELS,
  TEXTURE_PREFERENCES,
  WATER_INTAKE_LEVELS,
  WATER_HARDNESS_LEVELS,
  WATER_SENSITIVITY_LEVELS,
} from './skin-profile.constants';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class RecentProcedureDto {
  @ApiPropertyOptional({ enum: PROCEDURE_TYPES })
  @IsIn([...PROCEDURE_TYPES])
  type: string;

  @ApiPropertyOptional({
    description: 'ISO date string when the procedure happened',
  })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  performed_at?: string | null;
}

export class SafetyContextDto {
  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsIn([...SKIN_CONDITIONS], { each: true })
  conditions?: string[];

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsIn([...SKIN_MEDICATIONS], { each: true })
  medications?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  photosensitizing_other?: boolean;

  @ApiPropertyOptional({ type: [RecentProcedureDto] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecentProcedureDto)
  recent_procedures?: RecentProcedureDto[];
}

export class ReactionEntryDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(120)
  trigger: string;

  @ApiPropertyOptional({ enum: REACTION_TRIGGER_TYPES })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...REACTION_TRIGGER_TYPES])
  trigger_type?: string;

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsIn([...REACTION_TYPES], { each: true })
  reaction_types?: string[];

  @ApiPropertyOptional({ enum: REACTION_SEVERITIES })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...REACTION_SEVERITIES])
  severity?: string;

  @ApiPropertyOptional({ enum: REACTION_CERTAINTIES })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...REACTION_CERTAINTIES])
  certainty?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  patch_test_confirmed?: boolean;
}

export class ReactionHistoryDto {
  @ApiPropertyOptional({
    description:
      'Whether the user has known past skin reactions. False means the user answered that they have no known reaction history.',
  })
  @IsOptional()
  @IsBoolean()
  has_known_reactions?: boolean;

  @ApiPropertyOptional({ type: [ReactionEntryDto] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReactionEntryDto)
  entries?: ReactionEntryDto[];
}

export class ConcernDetailDto {
  @ApiPropertyOptional({ enum: SKIN_CONCERNS })
  @IsIn([...SKIN_CONCERNS])
  concern: string;

  @ApiPropertyOptional({ enum: REACTION_SEVERITIES })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...REACTION_SEVERITIES])
  severity?: string;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_months?: number;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsInt()
  @Min(1)
  priority?: number;

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  subtype?: string;

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggers?: string[];
}

export class ConcernDetailsDto {
  @ApiPropertyOptional({ type: [ConcernDetailDto] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConcernDetailDto)
  per_concern?: ConcernDetailDto[];
}

export class SkinBehaviorDto {
  @ApiPropertyOptional({ enum: TENDENCY_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...TENDENCY_LEVELS])
  burn_tendency?: string;

  @ApiPropertyOptional({ enum: TENDENCY_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...TENDENCY_LEVELS])
  tan_tendency?: string;

  @ApiPropertyOptional({ enum: TENDENCY_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...TENDENCY_LEVELS])
  pih_tendency?: string;

  @ApiPropertyOptional({ enum: TENDENCY_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...TENDENCY_LEVELS])
  melasma_tendency?: string;

  @ApiPropertyOptional({ enum: TENDENCY_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...TENDENCY_LEVELS])
  keloid_tendency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  daily_sun_exposure_hours?: string;

  @ApiPropertyOptional({ enum: SUNSCREEN_HABITS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...SUNSCREEN_HABITS])
  sunscreen_habit?: string;

  @ApiPropertyOptional({ enum: SUNSCREEN_TOLERANCES })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...SUNSCREEN_TOLERANCES])
  sunscreen_tolerance?: string;
}

export class ActiveToleranceDto {
  @ApiPropertyOptional({ enum: ACTIVE_TOLERANCE_LEVELS })
  @IsIn([...ACTIVE_TOLERANCE_LEVELS])
  tolerance: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  last_used?: string | null;
}

export class RoutinePreferencesDto {
  @ApiPropertyOptional({ enum: ROUTINE_PACES })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...ROUTINE_PACES])
  pace?: string;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  am_minutes?: number;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  pm_minutes?: number;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(7)
  max_active_nights_per_week?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fragrance_free?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  non_comedogenic?: boolean;

  @ApiPropertyOptional({ enum: SUNSCREEN_FILTERS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...SUNSCREEN_FILTERS])
  sunscreen_filter?: string;

  @ApiPropertyOptional({ enum: SUNSCREEN_FINISHES })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...SUNSCREEN_FINISHES])
  sunscreen_finish?: string;
}

export class LifestyleContextDto {
  @ApiPropertyOptional({ enum: SLEEP_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...SLEEP_LEVELS])
  sleep?: string;

  @ApiPropertyOptional({ enum: STRESS_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...STRESS_LEVELS])
  stress?: string;

  @ApiPropertyOptional({ enum: WATER_INTAKE_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...WATER_INTAKE_LEVELS])
  water_intake?: string;

  @ApiPropertyOptional({ enum: WATER_HARDNESS_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...WATER_HARDNESS_LEVELS])
  water_hardness?: string;

  @ApiPropertyOptional({ enum: WATER_SENSITIVITY_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...WATER_SENSITIVITY_LEVELS])
  water_sensitivity?: string;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  water_reaction_notes?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsIn([...DIET_FLAGS], { each: true })
  diet_flags?: string[];

  @ApiPropertyOptional({ enum: SMOKING_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...SMOKING_LEVELS])
  smoking?: string;

  @ApiPropertyOptional({ enum: ALCOHOL_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...ALCOHOL_LEVELS])
  alcohol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sweat_exercise?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mask_wearing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  shaving?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsIn([...CLIMATE_SENSITIVITIES], { each: true })
  climate_sensitivities?: string[];
}

export class ShoppingPreferencesDto {
  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ingredient_dislikes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  product_dislikes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  brand_dislikes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsIn([...INGREDIENT_ETHICS], { each: true })
  ingredient_ethics?: string[];

  @ApiPropertyOptional({ type: [String] })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @IsIn([...TEXTURE_PREFERENCES], { each: true })
  texture_preferences?: string[];
}

export class HormonalContextDto {
  @ApiPropertyOptional({ enum: CYCLE_PATTERNS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...CYCLE_PATTERNS])
  cycle_pattern?: string;

  @ApiPropertyOptional({ enum: HORMONAL_BREAKOUT_PATTERNS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...HORMONAL_BREAKOUT_PATTERNS])
  breakout_pattern?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  cycle_related_breakouts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  uses_hormonal_contraception?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  menopause_related_changes?: boolean;
}

export class CreateSkinProfileDto {
  @ApiPropertyOptional({ enum: SKIN_TYPES })
  @IsDefined()
  @IsIn([...SKIN_TYPES])
  skinType?: string;

  @ApiPropertyOptional({ enum: SKIN_TONES })
  @IsDefined()
  @IsIn([...SKIN_TONES])
  skinTone?: string;

  @ApiPropertyOptional({ description: 'ISO date of birth' })
  @IsDefined()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: SEX_AT_BIRTH })
  @IsDefined()
  @IsIn([...SEX_AT_BIRTH])
  sexAtBirth?: string;

  @ApiPropertyOptional({ enum: ETHNICITIES })
  @IsDefined()
  @IsIn([...ETHNICITIES])
  ethnicity?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsIn([...SKIN_CONCERNS], { each: true })
  currentConcerns?: string[];

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @ApiPropertyOptional({
    description:
      'Explicit consent for processing location data when country or city is provided',
  })
  @IsOptional()
  @IsBoolean()
  locationConsent?: boolean;

  @ApiPropertyOptional({ enum: FITZPATRICK_PHOTOTYPES })
  @IsDefined()
  @IsIn([...FITZPATRICK_PHOTOTYPES])
  fitzpatrickPhototype?: string;

  @ApiPropertyOptional({ enum: SENSITIVITY_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...SENSITIVITY_LEVELS])
  sensitivityLevel?: string;

  @ApiPropertyOptional({ enum: HYDRATION_LEVELS })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...HYDRATION_LEVELS])
  hydrationLevel?: string;

  @ApiPropertyOptional({ enum: SKIN_CONCERNS })
  @IsDefined()
  @IsIn([...SKIN_CONCERNS])
  primaryGoal?: string;

  @ApiPropertyOptional({ enum: PREGNANCY_STATUSES })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn([...PREGNANCY_STATUSES])
  pregnancyStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  underDermatologistCare?: string;

  @ApiPropertyOptional()
  @IsDefined()
  @IsBoolean()
  allowSmartPicks?: boolean;

  @ApiPropertyOptional({ enum: BUDGET_TIERS })
  @IsDefined()
  @IsIn([...BUDGET_TIERS])
  budgetTier?: string;

  @ApiPropertyOptional({ type: SafetyContextDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SafetyContextDto)
  safetyContext?: SafetyContextDto;

  @ApiPropertyOptional({ type: ReactionHistoryDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ReactionHistoryDto)
  reactionHistory?: ReactionHistoryDto;

  @ApiPropertyOptional({ type: ConcernDetailsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConcernDetailsDto)
  concernDetails?: ConcernDetailsDto;

  @ApiPropertyOptional({ type: SkinBehaviorDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SkinBehaviorDto)
  skinBehavior?: SkinBehaviorDto;

  @ApiPropertyOptional({
    description: 'Per-active tolerance keyed by ingredient',
    additionalProperties: { type: 'object' },
  })
  @IsOptional()
  @IsObject()
  activeTolerances?: Record<string, ActiveToleranceDto>;

  @ApiPropertyOptional({ type: RoutinePreferencesDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RoutinePreferencesDto)
  routinePreferences?: RoutinePreferencesDto;

  @ApiPropertyOptional({ type: LifestyleContextDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LifestyleContextDto)
  lifestyleContext?: LifestyleContextDto;

  @ApiPropertyOptional({ type: ShoppingPreferencesDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ShoppingPreferencesDto)
  shoppingPreferences?: ShoppingPreferencesDto;

  @ApiPropertyOptional({ type: HormonalContextDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HormonalContextDto)
  hormonalContext?: HormonalContextDto;

  @ApiPropertyOptional({
    description:
      'Explicit consent for processing health-context data (pregnancy, conditions, medications, recent procedures, dermatologist care). Required when a health-context field is provided.',
  })
  @IsOptional()
  @IsBoolean()
  healthContextConsent?: boolean;

  @ApiPropertyOptional({
    description:
      'Explicit consent for processing hormonal-context data. Required when hormonalContext is provided.',
  })
  @IsOptional()
  @IsBoolean()
  hormonalContextConsent?: boolean;
}
