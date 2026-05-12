import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';
import {
  SUGGESTION_GAP_ACTION_KINDS,
  SuggestionGapActionKind,
} from '../suggestions.constants';
import { SuggestionGapActionSourceType } from '../entities/suggestion-gap-action.entity';

export const SUGGESTION_GAP_ACTION_SOURCE_TYPES = [
  'today',
  'smart_pick',
] as const satisfies readonly SuggestionGapActionSourceType[];

export class NormalRoutineOverrideResponseDto {
  @ApiProperty()
  targetDate: string;

  @ApiProperty()
  expiresAt: string;

  @ApiProperty({ nullable: true })
  reactionEntryId: string | null;
}

export class RecordSuggestionGapActionDto {
  @ApiProperty({ enum: SUGGESTION_GAP_ACTION_SOURCE_TYPES, required: false })
  @IsOptional()
  @IsIn(SUGGESTION_GAP_ACTION_SOURCE_TYPES)
  sourceType?: SuggestionGapActionSourceType;

  @ApiProperty({ required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  suggestionInstanceId?: string;

  @ApiProperty({ required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(26)
  smartPickProductSuggestionId?: string;

  @ApiProperty({ required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  ingredientOrCategory?: string;

  @ApiProperty({ enum: SUGGESTION_GAP_ACTION_KINDS })
  @IsIn(SUGGESTION_GAP_ACTION_KINDS)
  action: SuggestionGapActionKind;
}

export class SuggestionGapActionResponseDto {
  @ApiProperty()
  sourceType: SuggestionGapActionSourceType;

  @ApiProperty({ nullable: true })
  suggestionInstanceId: string | null;

  @ApiProperty({ nullable: true })
  smartPickProductSuggestionId: string | null;

  @ApiProperty()
  ingredientOrCategory: string;

  @ApiProperty()
  normalizedKey: string;

  @ApiProperty({ enum: SUGGESTION_GAP_ACTION_KINDS })
  action: SuggestionGapActionKind;
}

export class SnoozeRecordingReminderDto {
  @ApiProperty()
  @IsString()
  @MaxLength(26)
  suggestionInstanceId: string;

  @ApiProperty({ required: false, minimum: 15, maximum: 180 })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  minutes?: number;
}

export class RecordingReminderSnoozeResponseDto {
  @ApiProperty()
  suggestionInstanceId: string;

  @ApiProperty()
  snoozedUntil: string;
}
