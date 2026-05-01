import { ApiProperty } from '@nestjs/swagger';
import { SkinJournalInsight } from '../entities/skin-journal-insight.entity';
import type {
  EventSeverity,
  InsightGenerationTrigger,
  InsightJobStatus,
  InsightKind,
} from '../skin-journal.constants';
import type {
  InsightAction,
  InsightBlock,
  InsightMetadata,
  InsightSourceCitation,
  InsightTimeWindow,
  LocalizedInsightText,
} from '../insights/insight-types';

export class JournalInsightResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  kind: InsightKind;

  @ApiProperty()
  severity: EventSeverity;

  @ApiProperty()
  confidence: number;

  @ApiProperty()
  headline: LocalizedInsightText;

  @ApiProperty({ type: [Object] })
  blocks: InsightBlock[];

  @ApiProperty({ type: [Object] })
  actions: InsightAction[];

  @ApiProperty({ type: [Object] })
  caveats: LocalizedInsightText[];

  @ApiProperty({ type: [String] })
  source_entry_ids: string[];

  @ApiProperty()
  time_window: InsightTimeWindow;

  @ApiProperty()
  data_cutoff_at: Date;

  @ApiProperty()
  generation_trigger: InsightGenerationTrigger;

  @ApiProperty()
  metadata: InsightMetadata;

  @ApiProperty({ type: [Object] })
  sources: InsightSourceCitation[];

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
    dto.severity = insight.severity;
    dto.confidence = insight.confidence;
    dto.headline = insight.headline;
    dto.blocks = insight.blocks;
    dto.actions = insight.actions;
    dto.caveats = insight.caveats;
    dto.source_entry_ids = insight.source_entry_ids;
    dto.time_window = insight.time_window;
    dto.data_cutoff_at = insight.data_cutoff_at;
    dto.generation_trigger = insight.generation_trigger;
    dto.metadata = insight.metadata;
    dto.sources = insight.sources;
    dto.generated_at = insight.generated_at;
    dto.seen_at = insight.seen_at;
    dto.dismissed_at = insight.dismissed_at;
    return dto;
  }
}

export class JournalInsightsMetaDto {
  @ApiProperty()
  total_entries: number;

  @ApiProperty()
  entries_until_next_insight: number;

  @ApiProperty({ required: false, nullable: true })
  last_generated_at: Date | null;

  @ApiProperty()
  generation_status: InsightJobStatus | 'idle';

  @ApiProperty({ required: false, nullable: true })
  active_job_trigger: InsightGenerationTrigger | null;

  @ApiProperty({ required: false, nullable: true })
  active_job_run_after: Date | null;

  @ApiProperty({ required: false, nullable: true })
  active_job_last_error: string | null;
}

export class JournalInsightsResponseDto {
  @ApiProperty({ type: [JournalInsightResponseDto] })
  insights: JournalInsightResponseDto[];

  @ApiProperty()
  meta: JournalInsightsMetaDto;
}
