import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import type {
  EventSeverity,
  InsightGenerationTrigger,
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

const encryptedHeadlineTransformer =
  encryptedJsonFieldTransformer<LocalizedInsightText>(
    'skin_journal_insights.headline',
    { key: 'journal.insightsTab.headlines.unknown', text: null },
  );
const encryptedBlocksTransformer = encryptedJsonFieldTransformer<
  InsightBlock[]
>('skin_journal_insights.blocks', []);
const encryptedActionsTransformer = encryptedJsonFieldTransformer<
  InsightAction[]
>('skin_journal_insights.actions', []);
const encryptedCaveatsTransformer = encryptedJsonFieldTransformer<
  LocalizedInsightText[]
>('skin_journal_insights.caveats', []);
const encryptedEntryIdsTransformer = encryptedJsonFieldTransformer<string[]>(
  'skin_journal_insights.source_entry_ids',
  [],
);
const encryptedTimeWindowTransformer =
  encryptedJsonFieldTransformer<InsightTimeWindow>(
    'skin_journal_insights.time_window',
    { start: '', end: '' },
  );
const encryptedMetadataTransformer =
  encryptedJsonFieldTransformer<InsightMetadata>(
    'skin_journal_insights.metadata',
    {
      source: 'deterministic',
      model: null,
      prompt_version: null,
      facts_hash: '',
      cache_hit: false,
      duration_ms: 0,
    },
  );
const encryptedSourcesTransformer = encryptedJsonFieldTransformer<
  InsightSourceCitation[]
>('skin_journal_insights.sources', []);

@Entity('skin_journal_insights')
@Index('IDX_skin_journal_insights_user_kind_dismissed', [
  'user_id',
  'kind',
  'dismissed_at',
])
@Index(
  'IDX_skin_journal_insights_user_signature',
  ['user_id', 'insight_signature'],
  { unique: true },
)
export class SkinJournalInsight {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'generated_at' })
  generated_at: Date;

  @Column({ type: 'varchar', length: 40 })
  kind: InsightKind;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity: EventSeverity;

  @Column({ type: 'double precision', default: 0.5 })
  confidence: number;

  @Column({
    type: 'jsonb',
    transformer: encryptedHeadlineTransformer,
  })
  headline: LocalizedInsightText;

  @Column({
    type: 'jsonb',
    transformer: encryptedBlocksTransformer,
  })
  blocks: InsightBlock[];

  @Column({
    type: 'jsonb',
    transformer: encryptedActionsTransformer,
  })
  actions: InsightAction[];

  @Column({
    type: 'jsonb',
    transformer: encryptedCaveatsTransformer,
  })
  caveats: LocalizedInsightText[];

  @Column({
    type: 'jsonb',
    transformer: encryptedEntryIdsTransformer,
  })
  source_entry_ids: string[];

  @Column({
    type: 'jsonb',
    transformer: encryptedTimeWindowTransformer,
  })
  time_window: InsightTimeWindow;

  @Column({ type: 'timestamptz' })
  data_cutoff_at: Date;

  @Column({ type: 'varchar', length: 40 })
  generation_trigger: InsightGenerationTrigger;

  @Column({
    type: 'jsonb',
    transformer: encryptedMetadataTransformer,
  })
  metadata: InsightMetadata;

  @Column({
    type: 'jsonb',
    transformer: encryptedSourcesTransformer,
  })
  sources: InsightSourceCitation[];

  @Column({ type: 'varchar', length: 120 })
  insight_signature: string;

  @Column({ type: 'timestamptz', nullable: true })
  seen_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  dismissed_at: Date | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
