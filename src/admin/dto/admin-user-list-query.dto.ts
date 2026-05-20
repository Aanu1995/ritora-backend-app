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
import { AdminUserRestrictionFilter } from '../admin.types';

export class AdminUserListQueryDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @EmptyStringToDefault(AdminUserRestrictionFilter.All)
  @IsOptional()
  @IsEnum(AdminUserRestrictionFilter)
  restriction: AdminUserRestrictionFilter = AdminUserRestrictionFilter.All;

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
