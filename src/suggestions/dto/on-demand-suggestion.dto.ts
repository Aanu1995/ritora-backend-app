import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  ON_DEMAND_SUGGESTION_INTENSITIES,
  ON_DEMAND_SUGGESTION_INTENTS,
  OnDemandSuggestionIntensity,
  OnDemandSuggestionIntent,
} from '../suggestions.constants';
import { EmptyStringToNull } from '../../common/dto/empty-string.transforms';

export class CreateOnDemandSuggestionDto {
  @ApiProperty({ enum: ON_DEMAND_SUGGESTION_INTENTS })
  @IsIn(ON_DEMAND_SUGGESTION_INTENTS)
  intent: OnDemandSuggestionIntent;

  @ApiPropertyOptional({
    enum: ON_DEMAND_SUGGESTION_INTENSITIES,
    default: 'standard',
  })
  @EmptyStringToNull()
  @IsOptional()
  @IsIn(ON_DEMAND_SUGGESTION_INTENSITIES)
  intensity?: OnDemandSuggestionIntensity | null;

  @ApiPropertyOptional({ maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;

  @ApiPropertyOptional()
  @EmptyStringToNull()
  @IsOptional()
  @IsDateString()
  activityAt?: string | null;

  @ApiPropertyOptional({ maxLength: 80 })
  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._:-]{8,80}$/)
  requestId?: string | null;
}
