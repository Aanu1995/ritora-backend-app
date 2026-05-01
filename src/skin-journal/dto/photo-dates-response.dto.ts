import { ApiProperty } from '@nestjs/swagger';
import type { AnalysisStatus } from '../skin-journal.constants';

export class PhotoDateDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  entry_id: string;

  @ApiProperty()
  analysis_status: AnalysisStatus;

  @ApiProperty()
  has_reaction: boolean;
}

export class PhotoMonthDto {
  @ApiProperty()
  month: string;

  @ApiProperty()
  photo_count: number;
}

export class PhotoDatesResponseDto {
  @ApiProperty({ type: [PhotoDateDto] })
  dates: PhotoDateDto[];

  @ApiProperty({ type: [PhotoMonthDto] })
  months: PhotoMonthDto[];
}
