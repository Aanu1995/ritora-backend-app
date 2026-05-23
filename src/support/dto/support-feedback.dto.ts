import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  EmptyStringToDefault,
  EmptyStringToNull,
  EmptyStringToUndefined,
} from '../../common/dto/empty-string.transforms';
import {
  SupportFeedbackPriority,
  SupportFeedbackSource,
  SupportFeedbackStatus,
  SupportFeedbackType,
} from '../entities/support-feedback-item.entity';
import { type SupportFeedbackContext } from '../support.types';

export enum SupportFeedbackStatusFilter {
  All = 'all',
  New = 'new',
  Triaged = 'triaged',
  Planned = 'planned',
  Fixed = 'fixed',
  Closed = 'closed',
}

export class SupportFeedbackContextDto implements SupportFeedbackContext {
  [key: string]: unknown;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  route?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  requestId?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  browser?: string;
}

export class CreateSupportFeedbackDto {
  @IsEnum(SupportFeedbackType)
  type!: SupportFeedbackType;

  @IsString()
  @MinLength(3, { message: 'validation.feedback.titleRequired' })
  @MaxLength(160, { message: 'validation.feedback.titleMaxLength' })
  title!: string;

  @IsString()
  @MinLength(8, { message: 'validation.feedback.descriptionRequired' })
  @MaxLength(5000, { message: 'validation.feedback.descriptionMaxLength' })
  description!: string;

  @IsOptional()
  @IsObject()
  context?: SupportFeedbackContextDto;
}

export class AdminSupportFeedbackListQueryDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @EmptyStringToDefault(SupportFeedbackStatusFilter.All)
  @IsOptional()
  @IsEnum(SupportFeedbackStatusFilter)
  status: SupportFeedbackStatusFilter = SupportFeedbackStatusFilter.All;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsEnum(SupportFeedbackType)
  type?: SupportFeedbackType;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsEnum(SupportFeedbackPriority)
  priority?: SupportFeedbackPriority;

  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  assignedAdminId?: string | null;

  @EmptyStringToDefault(20)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @EmptyStringToDefault(1)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
}

export class CreateAdminSupportFeedbackDto extends CreateSupportFeedbackDto {
  @IsEnum(SupportFeedbackSource)
  source: SupportFeedbackSource = SupportFeedbackSource.AdminCreated;

  @IsEnum(SupportFeedbackPriority)
  priority: SupportFeedbackPriority = SupportFeedbackPriority.Medium;

  @EmptyStringToNull()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  reporterEmail?: string | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  userIdentifier?: string | null;

  @IsString()
  @MinLength(8, { message: 'validation.reason.required' })
  @MaxLength(500)
  reason!: string;
}

export class UpdateAdminSupportFeedbackDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @IsEnum(SupportFeedbackStatus)
  status?: SupportFeedbackStatus;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsEnum(SupportFeedbackPriority)
  priority?: SupportFeedbackPriority;

  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  assignedAdminId?: string | null;

  @IsString()
  @MinLength(8, { message: 'validation.reason.required' })
  @MaxLength(500)
  reason!: string;
}

export class AdminSupportFeedbackNoteListQueryDto {
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

export class CreateAdminSupportFeedbackNoteDto {
  @IsString()
  @MinLength(3, { message: 'validation.feedback.noteRequired' })
  @MaxLength(3000, { message: 'validation.feedback.noteMaxLength' })
  body!: string;

  @IsString()
  @MinLength(8, { message: 'validation.reason.required' })
  @MaxLength(500)
  reason!: string;
}
