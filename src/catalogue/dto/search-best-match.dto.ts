import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class SearchBestMatchDto {
  @ApiProperty({ description: 'Search by brand and product name' })
  @IsString()
  @MaxLength(100)
  q!: string;
}
