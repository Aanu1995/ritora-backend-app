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
import {
  AdminAiCostFeatureFilter,
  AdminAiCostPeriod,
} from '../admin-ai-cost.types';

export class AdminAiCostUserListQueryDto {
  @EmptyStringToDefault(AdminAiCostFeatureFilter.All)
  @IsOptional()
  @IsEnum(AdminAiCostFeatureFilter)
  feature: AdminAiCostFeatureFilter = AdminAiCostFeatureFilter.All;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @EmptyStringToDefault(10)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;

  @EmptyStringToDefault(1)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;

  @EmptyStringToDefault(AdminAiCostPeriod.MonthToDate)
  @IsOptional()
  @IsEnum(AdminAiCostPeriod)
  period: AdminAiCostPeriod = AdminAiCostPeriod.MonthToDate;
}
