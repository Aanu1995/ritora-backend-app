import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { SuggestionDaypart, SuggestionMode } from '../suggestions.constants';
import { ApplicationLogResponseDto } from '../../application-tracking/dto/application-log-response.dto';
import { SuggestionInstanceResponseDto } from './suggestion-instance-response.dto';
import { TodaysSuggestionWeatherSummaryDto } from './todays-suggestion-response.dto';

export type SuggestionHistorySlotStatus =
  | 'applied'
  | 'partial'
  | 'skipped'
  | 'simplified'
  | 'missed';

export class SuggestionHistoryListQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', 'custom'] })
  @IsOptional()
  @IsIn(['7d', '30d', 'custom'])
  range?: '7d' | '30d' | 'custom';

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['morning', 'noon', 'evening'] })
  @IsOptional()
  @IsIn(['morning', 'noon', 'evening'])
  daypart?: SuggestionDaypart;

  @ApiPropertyOptional({
    enum: ['applied', 'partial', 'skipped', 'simplified', 'missed'],
  })
  @IsOptional()
  @IsIn(['applied', 'partial', 'skipped', 'simplified', 'missed'])
  status?: SuggestionHistorySlotStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  edited?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class SuggestionHistorySlotSummaryDto {
  @ApiProperty({ nullable: true })
  slotId: string | null;

  @ApiProperty({ nullable: true })
  suggestionId: string | null;

  @ApiProperty({ nullable: true })
  applicationLogId: string | null;

  @ApiProperty({ enum: ['morning', 'noon', 'evening'] })
  daypart: SuggestionDaypart;

  @ApiProperty()
  slotTime: string;

  @ApiProperty({ enum: ['ai', 'manual', 'mixed'] })
  mode: SuggestionMode;

  @ApiProperty()
  appliedCount: number;

  @ApiProperty()
  totalSteps: number;

  @ApiProperty({
    enum: ['applied', 'partial', 'skipped', 'simplified', 'missed'],
  })
  status: SuggestionHistorySlotStatus;

  @ApiProperty()
  hasBeenEdited: boolean;

  @ApiProperty()
  summaryLine: string;

  @ApiPropertyOptional({
    nullable: true,
    type: () => SuggestionInstanceResponseDto,
  })
  suggestion?: SuggestionInstanceResponseDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: () => ApplicationLogResponseDto,
  })
  applicationLog?: ApplicationLogResponseDto | null;
}

export class SuggestionHistoryDayDto {
  @ApiProperty()
  date: string;

  @ApiProperty({ nullable: true, type: TodaysSuggestionWeatherSummaryDto })
  weatherSummary: TodaysSuggestionWeatherSummaryDto | null;

  @ApiProperty({ nullable: true })
  moodScore: number | null;

  @ApiProperty({ nullable: true, enum: ['up', 'flat', 'down'] })
  hydrationTrend: 'up' | 'flat' | 'down' | null;

  @ApiProperty()
  reactionFlagged: boolean;

  @ApiProperty({ nullable: true })
  photoEntryId: string | null;

  @ApiProperty({ type: [SuggestionHistorySlotSummaryDto] })
  slots: SuggestionHistorySlotSummaryDto[];
}

export class SuggestionHistoryListResponseDto {
  @ApiProperty({ type: [SuggestionHistoryDayDto] })
  days: SuggestionHistoryDayDto[];

  @ApiProperty({ nullable: true })
  nextCursor: string | null;

  @ApiProperty()
  totalApplied: number;

  @ApiProperty()
  totalSlots: number;

  @ApiProperty({ nullable: true })
  adherencePercent: number | null;
}

export class RegenerateSuggestionDto {
  @ApiPropertyOptional({
    enum: ['user_requested', 'schedule_change', 'reaction_detected'],
  })
  @IsOptional()
  @IsIn(['user_requested', 'schedule_change', 'reaction_detected'])
  reason?: 'user_requested' | 'schedule_change' | 'reaction_detected';
}
