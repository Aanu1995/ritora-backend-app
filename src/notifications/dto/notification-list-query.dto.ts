import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  NOTIFICATION_PAGE_DEFAULT_LIMIT,
  NOTIFICATION_PAGE_MAX_LIMIT,
} from '../notifications.constants';
import {
  EmptyStringToDefault,
  EmptyStringToUndefined,
} from '../../common/dto/empty-string.transforms';

export class NotificationListQueryDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @EmptyStringToDefault(NOTIFICATION_PAGE_DEFAULT_LIMIT)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_PAGE_MAX_LIMIT)
  limit: number = NOTIFICATION_PAGE_DEFAULT_LIMIT;
}
