import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
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
} from '../../common/dto/empty-string.transforms';
import { AdminOperationalIncidentSeverity } from '../entities/admin-operational-incident.entity';

export enum AdminOperationalIncidentStatusFilter {
  All = 'all',
  Open = 'open',
  Resolved = 'resolved',
}

export class AdminOperationalIncidentListQueryDto {
  @EmptyStringToDefault(AdminOperationalIncidentStatusFilter.Open)
  @IsOptional()
  @IsEnum(AdminOperationalIncidentStatusFilter)
  status: AdminOperationalIncidentStatusFilter =
    AdminOperationalIncidentStatusFilter.Open;

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

export class CreateOperationalIncidentDto {
  @IsString()
  @MinLength(3, { message: 'validation.incident.titleRequired' })
  @MaxLength(160, { message: 'validation.incident.titleMaxLength' })
  title!: string;

  @IsString()
  @MinLength(8, { message: 'validation.incident.descriptionRequired' })
  @MaxLength(1000, { message: 'validation.incident.descriptionMaxLength' })
  description!: string;

  @IsEnum(AdminOperationalIncidentSeverity)
  severity!: AdminOperationalIncidentSeverity;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  sourceType!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  sourceId!: string;

  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  targetUserId?: string | null;
}

export class ResolveOperationalIncidentDto {
  @IsString()
  @MinLength(8, { message: 'validation.incident.resolutionRequired' })
  @MaxLength(1000, { message: 'validation.incident.resolutionMaxLength' })
  resolutionSummary!: string;
}
