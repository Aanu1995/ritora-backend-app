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
import { SHELF_PAGE_SIZE } from '../../shelf/shelf.constants';

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

  @ApiPropertyOptional({ default: SHELF_PAGE_SIZE, maximum: SHELF_PAGE_SIZE })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? SHELF_PAGE_SIZE : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(SHELF_PAGE_SIZE)
  limit = SHELF_PAGE_SIZE;
}
