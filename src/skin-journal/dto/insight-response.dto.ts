import { ApiProperty } from '@nestjs/swagger';
import { SkinJournalInsight } from '../entities/skin-journal-insight.entity';
import type { EventSeverity, InsightKind } from '../skin-journal.constants';

export class JournalInsightResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  kind: InsightKind;

  @ApiProperty({ required: false, nullable: true })
  summary: string | null;

  @ApiProperty({ required: false, nullable: true })
  supporting_data: Record<string, unknown> | null;

  @ApiProperty({ required: false, nullable: true })
  related_entry_ids: string[] | null;

  @ApiProperty()
  severity: EventSeverity;

  @ApiProperty()
  generated_at: Date;

  @ApiProperty({ required: false, nullable: true })
  seen_at: Date | null;

  @ApiProperty({ required: false, nullable: true })
  dismissed_at: Date | null;

  static fromEntity(insight: SkinJournalInsight): JournalInsightResponseDto {
    const dto = new JournalInsightResponseDto();
    dto.id = insight.id;
    dto.kind = insight.kind;
    dto.summary = insight.summary;
    dto.supporting_data = insight.supporting_data;
    dto.related_entry_ids = insight.related_entry_ids;
    dto.severity = insight.severity;
    dto.generated_at = insight.generated_at;
    dto.seen_at = insight.seen_at;
    dto.dismissed_at = insight.dismissed_at;
    return dto;
  }
}
