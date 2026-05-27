import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminAnalysisFeedbackExportDto {
  @ApiProperty({ minLength: 8, maxLength: 500 })
  @IsString()
  @MinLength(8)
  @MaxLength(500)
  reason: string;
}
