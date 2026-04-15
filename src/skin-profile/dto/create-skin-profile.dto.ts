import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  AGE_RANGES,
  ETHNICITIES,
  ROUTINE_COMPLEXITIES,
  SKIN_CONCERNS,
  SKIN_GOALS,
  SKIN_TONES,
  SKIN_TYPES,
} from './skin-profile.constants';

export class CreateSkinProfileDto {
  @ApiPropertyOptional({ enum: SKIN_TYPES })
  @IsOptional()
  @IsIn([...SKIN_TYPES])
  skinType?: string;

  @ApiPropertyOptional({ enum: SKIN_TONES })
  @IsOptional()
  @IsIn([...SKIN_TONES])
  skinTone?: string;

  @ApiPropertyOptional({ enum: AGE_RANGES })
  @IsOptional()
  @IsIn([...AGE_RANGES])
  ageRange?: string;

  @ApiPropertyOptional({ enum: ETHNICITIES })
  @IsOptional()
  @IsIn([...ETHNICITIES])
  ethnicity?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn([...SKIN_CONCERNS], { each: true })
  currentConcerns?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knownSensitivities?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn([...SKIN_GOALS], { each: true })
  skinGoals?: string[];

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    description:
      'Explicit consent for processing location data when country or city is provided',
  })
  @IsOptional()
  @IsBoolean()
  locationConsent?: boolean;

  @ApiPropertyOptional({ enum: ROUTINE_COMPLEXITIES })
  @IsOptional()
  @IsIn([...ROUTINE_COMPLEXITIES])
  routineComplexity?: string;
}
