import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EmptyStringToDefault,
  EmptyStringToUndefined,
} from '../../common/dto/empty-string.transforms';
import { AdminAuditAction } from '../entities/admin-audit-log.entity';

export class AdminAuditLogQueryDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @IsEnum(AdminAuditAction)
  action?: AdminAuditAction;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  monitoringFlagId?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  targetAdminId?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  targetUserId?: string;

  @EmptyStringToDefault(25)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @EmptyStringToDefault(1)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
}
