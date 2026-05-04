import { ApiProperty } from '@nestjs/swagger';
import {
  SuggestionDaypart,
  SuggestionMode,
  SuggestionSlotLifecycleStatus,
} from '../suggestions.constants';
import { SuggestionInstanceResponseDto } from './suggestion-instance-response.dto';

export class TodaysSuggestionWeatherSummaryDto {
  @ApiProperty({ nullable: true })
  temperatureCelsius: number | null;

  @ApiProperty({ nullable: true })
  uvIndex: number | null;

  @ApiProperty({ nullable: true })
  humidity: number | null;

  @ApiProperty({ nullable: true })
  conditionLabel: string | null;
}

export class TodaysSuggestionReactionAlertDto {
  @ApiProperty()
  detectedAt: string;

  @ApiProperty()
  photoEntryId: string;

  @ApiProperty()
  summary: string;

  @ApiProperty({ type: [String] })
  pausedActiveNames: string[];
}

export class TodaysSuggestionRecordingDto {
  @ApiProperty()
  applicationLogId: string;

  @ApiProperty({ nullable: true })
  appliedAt: string | null;

  @ApiProperty()
  hasBeenEdited: boolean;

  @ApiProperty()
  editCount: number;

  @ApiProperty({ nullable: true })
  lastEditedAt: string | null;

  @ApiProperty()
  appliedCount: number;

  @ApiProperty()
  totalItems: number;
}

export class TodaysSuggestionSlotDto {
  @ApiProperty()
  slotId: string;

  @ApiProperty({ enum: ['morning', 'noon', 'evening'] })
  daypart: SuggestionDaypart;

  @ApiProperty()
  slotTime: string;

  @ApiProperty({ enum: ['ai', 'manual', 'mixed'] })
  mode: SuggestionMode;

  @ApiProperty({ nullable: true })
  slotNotes: string | null;

  @ApiProperty()
  routineStepCount: number;

  @ApiProperty()
  specialistLockedStepCount: number;

  @ApiProperty()
  visibleAt: string;

  @ApiProperty()
  isVisible: boolean;

  @ApiProperty({
    enum: [
      'locked',
      'generating',
      'ready',
      'active',
      'recordable',
      'recorded',
      'edited',
      'missed',
      'failed',
    ],
  })
  status: SuggestionSlotLifecycleStatus;

  @ApiProperty()
  slotStartsAt: string;

  @ApiProperty()
  recordableAt: string;

  @ApiProperty()
  expiresAt: string;

  @ApiProperty({ nullable: true, type: () => TodaysSuggestionRecordingDto })
  recording: TodaysSuggestionRecordingDto | null;

  @ApiProperty({ nullable: true, type: SuggestionInstanceResponseDto })
  suggestion: SuggestionInstanceResponseDto | null;
}

export class TodaysSuggestionSummaryDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  locked: number;

  @ApiProperty()
  upcoming: number;

  @ApiProperty()
  ready: number;

  @ApiProperty()
  recordable: number;

  @ApiProperty()
  recorded: number;

  @ApiProperty()
  edited: number;

  @ApiProperty()
  failed: number;
}

export class TodaysSuggestionResponseDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  timeZone: string;

  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  leadTimeMinutes: number;

  @ApiProperty({ type: TodaysSuggestionSummaryDto })
  summary: TodaysSuggestionSummaryDto;

  @ApiProperty({ nullable: true, type: TodaysSuggestionWeatherSummaryDto })
  weatherSummary: TodaysSuggestionWeatherSummaryDto | null;

  @ApiProperty({ type: [TodaysSuggestionSlotDto] })
  slots: TodaysSuggestionSlotDto[];

  @ApiProperty({ nullable: true, type: TodaysSuggestionReactionAlertDto })
  reactionAlert: TodaysSuggestionReactionAlertDto | null;
}
