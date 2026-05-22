import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { EmptyStringToDefault } from '../../common/dto/empty-string.transforms';

export class AdminNotificationListQueryDto {
  @EmptyStringToDefault(10)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}
