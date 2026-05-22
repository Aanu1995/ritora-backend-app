import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ProductCategory,
  ShelfSort,
  ShelfStatFilter,
} from '../../shelf/shelf.types';
import {
  PRODUCT_CATEGORY_VALUES,
  DEFAULT_SHELF_PAGE_SIZE,
  MAX_SHELF_PAGE_SIZE,
} from '../../shelf/shelf.constants';
import {
  EmptyStringToDefault,
  EmptyStringToUndefined,
} from '../../common/dto/empty-string.transforms';

const CATEGORY_QUERY_VALUES: Array<ProductCategory | 'all'> = [
  ...PRODUCT_CATEGORY_VALUES,
  'all',
];

export class InventoryListQueryDto {
  @EmptyStringToDefault(ShelfStatFilter.All)
  @IsOptional()
  @IsEnum(ShelfStatFilter)
  stat: ShelfStatFilter = ShelfStatFilter.All;

  @EmptyStringToDefault('all')
  @IsOptional()
  @IsIn(CATEGORY_QUERY_VALUES)
  category: ProductCategory | 'all' = 'all';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search = '';

  @EmptyStringToDefault(ShelfSort.RecentlyAdded)
  @IsOptional()
  @IsEnum(ShelfSort)
  sort: ShelfSort = ShelfSort.RecentlyAdded;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @EmptyStringToDefault(DEFAULT_SHELF_PAGE_SIZE)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SHELF_PAGE_SIZE)
  limit: number = DEFAULT_SHELF_PAGE_SIZE;
}
