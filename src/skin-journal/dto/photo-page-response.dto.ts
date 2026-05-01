import { ApiProperty } from '@nestjs/swagger';
import { JournalEntryResponseDto } from './journal-entry-response.dto';

export class PhotoPageResponseDto {
  @ApiProperty({ type: [JournalEntryResponseDto] })
  items: JournalEntryResponseDto[];

  @ApiProperty({ required: false, nullable: true })
  nextCursor: string | null;
}
