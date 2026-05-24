import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CommunityDisclosureType,
  CommunityContentType,
  CommunityGoalResult,
  CommunityGoalTimeframe,
  CommunityHelpfulnessVote,
  CommunityModerationStatus,
  CommunityOutcomeFollowedPart,
  CommunityOutcomeIrritationLevel,
  CommunityOutcomeSignal,
  CommunityOutcomeTrialDuration,
  CommunityReportReason,
  CommunityReportStatus,
  CommunityReviewRoutineSlot,
  CommunityReviewSkinResponse,
  CommunitySafetySeverity,
} from '../community.types';
import { MAX_COMMUNITY_MIN_ACCOUNT_AGE_DAYS } from '../entities/community-settings.entity';

export class CommunityRoutineStepDto {
  @IsIn(['am', 'pm', 'either'])
  slot: 'am' | 'pm' | 'either';

  @IsOptional()
  @IsString()
  productId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productBrand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productName?: string | null;

  @IsString()
  @MaxLength(40)
  category: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  frequency?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class CreateCommunityRoutineDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string | null;

  @IsEnum(CommunityDisclosureType)
  disclosureType: CommunityDisclosureType;

  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  concernTags: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  goalTags: string[];

  @IsOptional()
  @IsEnum(CommunityGoalResult)
  goalResult?: CommunityGoalResult | null;

  @IsEnum(CommunityGoalTimeframe)
  timeframe: CommunityGoalTimeframe;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  avoidTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  habitTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  didNotWorkTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  warningTags?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CommunityRoutineStepDto)
  steps: CommunityRoutineStepDto[];
}

export class EditCommunityRoutineDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string | null;

  @IsOptional()
  @IsEnum(CommunityDisclosureType)
  disclosureType?: CommunityDisclosureType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  concernTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  goalTags?: string[];

  @IsOptional()
  @IsEnum(CommunityGoalResult)
  goalResult?: CommunityGoalResult | null;

  @IsOptional()
  @IsEnum(CommunityGoalTimeframe)
  timeframe?: CommunityGoalTimeframe;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  avoidTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  habitTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  didNotWorkTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  warningTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CommunityRoutineStepDto)
  steps?: CommunityRoutineStepDto[];
}

export class CommunityReviewContextProductDto {
  @IsOptional()
  @IsString()
  productId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productBrand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productName?: string | null;

  @IsString()
  @MaxLength(40)
  category: string;
}

export class CreateCommunityReviewDto {
  @IsOptional()
  @IsString()
  productId?: string | null;

  @IsString()
  @MaxLength(255)
  productBrand: string;

  @IsString()
  @MaxLength(255)
  productName: string;

  @IsString()
  @MaxLength(40)
  productCategory: string;

  @IsEnum(CommunityDisclosureType)
  disclosureType: CommunityDisclosureType;

  @IsString()
  @MaxLength(30)
  usageDuration: string;

  @IsString()
  @MaxLength(50)
  frequency: string;

  @IsEnum(CommunityReviewRoutineSlot)
  routineSlot: CommunityReviewRoutineSlot;

  @IsEnum(CommunityReviewSkinResponse)
  skinResponse: CommunityReviewSkinResponse;

  @IsInt()
  @Min(1)
  @Max(5)
  overallRating: number;

  @IsInt()
  @Min(1)
  @Max(5)
  effectivenessRating: number;

  @IsInt()
  @Min(1)
  @Max(5)
  irritationRating: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  textureRating?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  valueRating?: number | null;

  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  outcomes: string[];

  @IsString()
  @MaxLength(30)
  repurchase: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CommunityReviewContextProductDto)
  routineContext: CommunityReviewContextProductDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  body?: string | null;
}

export class EditCommunityReviewDto {
  @IsOptional()
  @IsString()
  productId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productBrand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  productCategory?: string;

  @IsOptional()
  @IsEnum(CommunityDisclosureType)
  disclosureType?: CommunityDisclosureType;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  usageDuration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  frequency?: string;

  @IsOptional()
  @IsEnum(CommunityReviewRoutineSlot)
  routineSlot?: CommunityReviewRoutineSlot;

  @IsOptional()
  @IsEnum(CommunityReviewSkinResponse)
  skinResponse?: CommunityReviewSkinResponse;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  overallRating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  effectivenessRating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  irritationRating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  textureRating?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  valueRating?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  outcomes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(30)
  repurchase?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CommunityReviewContextProductDto)
  routineContext?: CommunityReviewContextProductDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  body?: string | null;
}

export class CreateCommunityReportDto {
  @IsEnum(CommunityReportReason)
  reason: CommunityReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class CommunityHelpfulnessDto {
  @IsEnum(CommunityHelpfulnessVote)
  vote: CommunityHelpfulnessVote;
}

export class CommunityOutcomeSignalDto {
  @IsEnum(CommunityOutcomeSignal)
  signal: CommunityOutcomeSignal;

  @IsBoolean()
  sameGoal: boolean;

  @IsEnum(CommunityOutcomeTrialDuration)
  trialDuration: CommunityOutcomeTrialDuration;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsEnum(CommunityOutcomeFollowedPart, { each: true })
  followedParts: CommunityOutcomeFollowedPart[];

  @IsEnum(CommunityOutcomeIrritationLevel)
  irritationLevel: CommunityOutcomeIrritationLevel;
}

export class SaveCommunityAdaptationDto {
  @IsString()
  adaptationId: string;
}

export class AdminCommunityModerationQueryDto {
  @IsOptional()
  @IsEnum(CommunityModerationStatus)
  status?: CommunityModerationStatus;

  @IsOptional()
  @IsEnum(CommunityContentType)
  contentType?: CommunityContentType;

  @IsOptional()
  @IsEnum(CommunityReportReason)
  reason?: CommunityReportReason;

  @IsOptional()
  @IsEnum(CommunityDisclosureType)
  disclosureType?: CommunityDisclosureType;

  @IsOptional()
  @IsEnum(CommunitySafetySeverity)
  severity?: CommunitySafetySeverity;

  @IsOptional()
  @IsString()
  assignedAdminId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class AdminCommunityModerationDto {
  @IsEnum(CommunityModerationStatus)
  status: CommunityModerationStatus;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class AdminCommunityNoteDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note: string;
}

export class AdminCommunityReportStatusDto {
  @IsEnum(CommunityReportStatus)
  status: CommunityReportStatus;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class AdminCommunityAssignDto {
  @IsOptional()
  @IsString()
  assignedAdminId?: string | null;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class AdminCommunitySettingsDto {
  @IsInt()
  @Min(0)
  @Max(MAX_COMMUNITY_MIN_ACCOUNT_AGE_DAYS)
  minimumAccountAgeDays: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class AdminCommunityWarningDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  body: string;

  @IsEnum(CommunitySafetySeverity)
  severity: CommunitySafetySeverity;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  affectedFacets: string[] = [];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
