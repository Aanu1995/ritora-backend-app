import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CatalogueSource } from '../../shelf/shelf.types';

export class ResolveCandidateDto {
  @ApiProperty({ enum: CatalogueSource })
  @IsEnum(CatalogueSource)
  source!: CatalogueSource;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}
