import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CommunityDisclosureType,
  CommunityContentType,
  CommunityHelpfulnessVote,
  CommunityModerationStatus,
  CommunityReportReason,
  CommunityReportStatus,
  CommunitySafetySeverity,
} from '../community.types';

export class CommunityRoutineStepDto {
  @IsIn(['am', 'pm', 'either'])
  slot: 'am' | 'pm' | 'either';

  @IsOptional()
  @IsString()
  productId?: string | null;

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
  @ArrayMaxSize(12)
  @IsString({ each: true })
  goalTags: string[];

  @IsArray()
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
}

export class CommunityReviewContextProductDto {
  @IsOptional()
  @IsString()
  productId?: string | null;

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
