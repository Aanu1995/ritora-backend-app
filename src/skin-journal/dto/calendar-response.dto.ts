import { ApiProperty } from '@nestjs/swagger';
import type { AnalysisStatus } from '../skin-journal.constants';

export type CalendarDayState =
  | 'no_entry'
  | 'entry_no_photo'
  | 'pending'
  | 'completed'
  | 'reaction'
  | 'failed';

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
