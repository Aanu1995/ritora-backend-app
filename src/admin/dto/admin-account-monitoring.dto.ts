import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  EmptyStringToDefault,
  EmptyStringToNull,
  EmptyStringToUndefined,
} from '../../common/dto/empty-string.transforms';
import {
  AdminAccountMonitoringSeverity,
  AdminAccountMonitoringSignalType,
  AdminAccountMonitoringStatus,
} from '../entities/admin-account-monitoring-flag.entity';

export enum AdminAccountMonitoringStatusFilter {
  Active = 'active',
  All = 'all',
  Open = 'open',
  Resolved = 'resolved',
  Watching = 'watching',
}

export class AdminAccountMonitoringListQueryDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @EmptyStringToDefault(AdminAccountMonitoringStatusFilter.Active)
  @IsOptional()
  @IsEnum(AdminAccountMonitoringStatusFilter)
  status: AdminAccountMonitoringStatusFilter =
    AdminAccountMonitoringStatusFilter.Active;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsEnum(AdminAccountMonitoringSignalType)
  signalType?: AdminAccountMonitoringSignalType;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  assignedAdminId?: string;

  @EmptyStringToDefault(10)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;

  @EmptyStringToDefault(1)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
}

export class CreateAdminAccountMonitoringFlagDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  userIdentifier!: string;

  @IsEnum(AdminAccountMonitoringSignalType)
  signalType!: AdminAccountMonitoringSignalType;

  @IsEnum(AdminAccountMonitoringSeverity)
  severity!: AdminAccountMonitoringSeverity;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  summary!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  latestSignal!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  internalNote!: string;

  @EmptyStringToNull()
  @IsOptional()
  @IsDateString()
  nextReviewAt?: string | null;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  reason!: string;
}

export class CreateAdminAccountMonitoringSupportEventDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  userIdentifier!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  supportReference!: string;

  @IsEnum(AdminAccountMonitoringSeverity)
  severity!: AdminAccountMonitoringSeverity;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  summary!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  latestSignal!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  internalNote!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  reason!: string;
}

export class UpdateAdminAccountMonitoringFlagDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @IsEnum(AdminAccountMonitoringStatus)
  status?:
    | AdminAccountMonitoringStatus.Open
    | AdminAccountMonitoringStatus.Watching;

  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  assignedAdminId?: string | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsDateString()
  nextReviewAt?: string | null;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  latestSignal?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  internalNote?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  reason!: string;
}

export class AdminAccountMonitoringTimelineQueryDto {
  @EmptyStringToDefault(20)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class ResolveAdminAccountMonitoringFlagDto {
  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  resolutionNote!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  reason!: string;
}

export class AdminAccountMonitoringThresholdsDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  aiGenerations24hWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  aiGenerations24hCritical!: number;

  @IsNumber()
  @Min(0)
  @Max(100000)
  aiCost24hWarningUsd!: number;

  @IsNumber()
  @Min(0)
  @Max(100000)
  aiCost24hCriticalUsd!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  productExtractions24hWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  uploadFailures24hWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  authFailures24hWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  passwordResets24hWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  deletionEvents30dWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  mediaCleanupFailures24hWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  mediaCleanupAttempts24hWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  safetyReactionSignals7dWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  unknownAuthFailures24hWarning!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  unknownAuthFailures24hCritical!: number;
}

export class UpdateAdminAccountMonitoringSettingsDto {
  @ValidateNested()
  @Type(() => AdminAccountMonitoringThresholdsDto)
  thresholds!: AdminAccountMonitoringThresholdsDto;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  reason!: string;
}
