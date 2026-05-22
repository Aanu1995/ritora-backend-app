import { ApiProperty } from '@nestjs/swagger';
import { JournalEntryResponseDto } from './journal-entry-response.dto';
import { JournalEventResponseDto } from './event-response.dto';
import { JournalInsightResponseDto } from './insight-response.dto';

export class DayDetailResponseDto {
  @ApiProperty()
  date: string;

  @ApiProperty({ required: false, nullable: true })
  entry: JournalEntryResponseDto | null;

  @ApiProperty({ type: [JournalEventResponseDto] })
  events: JournalEventResponseDto[];

  @ApiProperty({ type: [JournalInsightResponseDto] })
  insights: JournalInsightResponseDto[];
}
