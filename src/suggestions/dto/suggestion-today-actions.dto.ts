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
import {
  SUGGESTION_GAP_ACTION_KINDS,
  SuggestionGapActionKind,
} from '../suggestions.constants';

export class NormalRoutineOverrideResponseDto {
  @ApiProperty()
  targetDate: string;

  @ApiProperty()
  expiresAt: string;

  @ApiProperty({ nullable: true })
  reactionEntryId: string | null;
}

export class RecordSuggestionGapActionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(26)
  suggestionInstanceId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  ingredientOrCategory: string;

  @ApiProperty({ enum: SUGGESTION_GAP_ACTION_KINDS })
  @IsIn(SUGGESTION_GAP_ACTION_KINDS)
  action: SuggestionGapActionKind;
}

export class SuggestionGapActionResponseDto {
  @ApiProperty()
  suggestionInstanceId: string;

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
