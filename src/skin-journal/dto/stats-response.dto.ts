import { ApiProperty } from '@nestjs/swagger';

export class JournalStatsResponseDto {
  @ApiProperty()
  current_streak: number;

  @ApiProperty()
  total_entries: number;

  @ApiProperty()
  weekly_upload_rate: number;

  @ApiProperty()
  weekly_uploads: number;

  @ApiProperty()
  weekly_target: number;

  @ApiProperty({ required: false, nullable: true })
  first_entry_date: string | null;
}
