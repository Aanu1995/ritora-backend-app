import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  SUGGESTION_DAYPARTS,
  SUGGESTION_HISTORY_RANGES,
  SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT,
  SUGGESTION_HISTORY_PAGE_MAX_LIMIT,
  SUGGESTION_HISTORY_SLOT_STATUSES,
  SUGGESTION_MODES,
  SUGGESTION_REQUEST_SOURCES,
  SuggestionDaypart,
  SuggestionHistoryRange,
  SuggestionHistorySlotStatus,
  SuggestionMode,
  SuggestionRegenerationReason,
  SuggestionRequestSource,
  SUGGESTION_REGENERATION_REASONS,
} from '../suggestions.constants';
import { ApplicationLogResponseDto } from '../../application-tracking/dto/application-log-response.dto';
import {
  EmptyStringToDefault,
  EmptyStringToNull,
  EmptyStringToUndefined,
} from '../../common/dto/empty-string.transforms';
import { SuggestionInstanceResponseDto } from './suggestion-instance-response.dto';
import {
  TodaysSuggestionEnvironmentSummaryDto,
  TodaysSuggestionWeatherSummaryDto,
} from './todays-suggestion-response.dto';

export class SuggestionHistoryListQueryDto {
  @ApiPropertyOptional({ enum: SUGGESTION_HISTORY_RANGES })
  @EmptyStringToNull()
  @IsOptional()
  @IsIn(SUGGESTION_HISTORY_RANGES)
  range?: SuggestionHistoryRange | null;

  @ApiPropertyOptional({ format: 'date' })
  @EmptyStringToNull()
  @IsOptional()
  @IsDateString()
  from?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @EmptyStringToNull()
  @IsOptional()
  @IsDateString()
  to?: string | null;

  @ApiPropertyOptional({ enum: SUGGESTION_DAYPARTS })
  @EmptyStringToNull()
  @IsOptional()
  @IsIn(SUGGESTION_DAYPARTS)
  daypart?: SuggestionDaypart | null;

  @ApiPropertyOptional({ enum: SUGGESTION_MODES })
  @EmptyStringToNull()
  @IsOptional()
  @IsIn(SUGGESTION_MODES)
  mode?: SuggestionMode | null;

  @ApiPropertyOptional({ enum: SUGGESTION_REQUEST_SOURCES })
  @EmptyStringToNull()
  @IsOptional()
  @IsIn(SUGGESTION_REQUEST_SOURCES)
  requestSource?: SuggestionRequestSource | null;

  @ApiPropertyOptional({ enum: SUGGESTION_HISTORY_SLOT_STATUSES })
  @EmptyStringToNull()
  @IsOptional()
  @IsIn(SUGGESTION_HISTORY_SLOT_STATUSES)
  status?: SuggestionHistorySlotStatus | null;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  edited?: boolean;

  @ApiPropertyOptional()
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: SUGGESTION_HISTORY_PAGE_MAX_LIMIT,
    default: SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT,
  })
  @EmptyStringToDefault(SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SUGGESTION_HISTORY_PAGE_MAX_LIMIT)
  limit?: number = SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT;
}

export class SuggestionHistorySlotSummaryDto {
  @ApiProperty({ nullable: true })
  slotId: string | null;

  @ApiProperty({ nullable: true })
  suggestionId: string | null;

  @ApiProperty({ nullable: true })
  applicationLogId: string | null;

  @ApiProperty({ enum: SUGGESTION_REQUEST_SOURCES })
  requestSource: SuggestionRequestSource;

  @ApiProperty({ nullable: true })
  onDemandIntent: string | null;

  @ApiProperty({ enum: SUGGESTION_DAYPARTS })
  daypart: SuggestionDaypart;

  @ApiProperty()
  slotTime: string;

  @ApiProperty({ enum: SUGGESTION_MODES })
  mode: SuggestionMode;

  @ApiProperty()
  appliedCount: number;

  @ApiProperty()
  totalSteps: number;

  @ApiProperty({ enum: SUGGESTION_HISTORY_SLOT_STATUSES })
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

  @ApiProperty({
    nullable: true,
    type: TodaysSuggestionEnvironmentSummaryDto,
  })
  environmentSummary: TodaysSuggestionEnvironmentSummaryDto | null;

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

  @ApiProperty()
  totalEdited: number;
}

export type SuggestionHistoryExportFile = {
  fileName: string;
  contentType: 'text/csv; charset=utf-8';
  body: string;
};

export class RegenerateSuggestionDto {
  @ApiPropertyOptional({
    enum: SUGGESTION_REGENERATION_REASONS,
  })
  @IsOptional()
  @IsIn(SUGGESTION_REGENERATION_REASONS)
  reason?: SuggestionRegenerationReason;
}
