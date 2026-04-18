import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DEFAULT_SHELF_PAGE_SIZE,
  MAX_SHELF_PAGE_SIZE,
} from '../../shelf/shelf.constants';

export class CatalogueSearchQueryDto {
  @ApiPropertyOptional({ description: 'Search by brand and product name' })
  @IsString()
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({
    default: DEFAULT_SHELF_PAGE_SIZE,
    maximum: MAX_SHELF_PAGE_SIZE,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? DEFAULT_SHELF_PAGE_SIZE : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(MAX_SHELF_PAGE_SIZE)
  limit = DEFAULT_SHELF_PAGE_SIZE;
}
