import { ApiProperty } from '@nestjs/swagger';
import type { AnalysisStatus } from '../skin-journal.constants';

export const CalendarDayStateValue = {
  NoEntry: 'no_entry',
  EntryNoPhoto: 'entry_no_photo',
  Pending: 'pending',
  Completed: 'completed',
  Reaction: 'reaction',
  Failed: 'failed',
} as const;

export type CalendarDayState =
  (typeof CalendarDayStateValue)[keyof typeof CalendarDayStateValue];

export class CalendarDayDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  state: CalendarDayState;

  @ApiProperty({ required: false, nullable: true })
  entry_id: string | null;

  @ApiProperty()
  has_photo: boolean;

  @ApiProperty()
  has_reaction: boolean;

  @ApiProperty()
  has_insight: boolean;

  @ApiProperty({ required: false, nullable: true })
  thumbnail_url: string | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_status: AnalysisStatus | null;
}

export class CalendarResponseDto {
  @ApiProperty()
  month: string;

  @ApiProperty({ type: [CalendarDayDto] })
  days: CalendarDayDto[];
}
