import { ApiProperty } from '@nestjs/swagger';
import { SkinJournalEvent } from '../entities/skin-journal-event.entity';
import type { EventKind, EventSeverity } from '../skin-journal.constants';

export class JournalEventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  entry_id: string;

  @ApiProperty()
  kind: EventKind;

  @ApiProperty()
  severity: EventSeverity;

  @ApiProperty({ required: false, nullable: true })
  payload: Record<string, unknown> | null;

  @ApiProperty({ required: false, nullable: true })
  acknowledged_at: Date | null;

  @ApiProperty()
  created_at: Date;

  static fromEntity(event: SkinJournalEvent): JournalEventResponseDto {
    const dto = new JournalEventResponseDto();
    dto.id = event.id;
    dto.entry_id = event.entry_id;
    dto.kind = event.kind;
    dto.severity = event.severity;
    dto.payload = event.payload;
    dto.acknowledged_at = event.acknowledged_at;
    dto.created_at = event.created_at;
    return dto;
  }
}
