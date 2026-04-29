import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import {
  encryptedJsonFieldTransformer,
  encryptedNullableStringFieldTransformer,
} from '../../skin-profile/skin-profile-field-encryption';
import type { EventSeverity, InsightKind } from '../skin-journal.constants';

const encryptedSupportingDataTransformer = encryptedJsonFieldTransformer<Record<
  string,
  unknown
> | null>('skin_journal_insights.supporting_data', null);
const encryptedRelatedEntryIdsTransformer = encryptedJsonFieldTransformer<
  string[] | null
>('skin_journal_insights.related_entry_ids', null);

@Entity('skin_journal_insights')
@Index('IDX_skin_journal_insights_user_kind_dismissed', [
  'user_id',
  'kind',
  'dismissed_at',
])
export class SkinJournalInsight {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'generated_at' })
  generated_at: Date;

  @Column({ type: 'varchar', length: 40 })
  kind: InsightKind;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedNullableStringFieldTransformer(
      'skin_journal_insights.summary',
    ),
  })
  summary: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedSupportingDataTransformer,
  })
  supporting_data: Record<string, unknown> | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedRelatedEntryIdsTransformer,
  })
  related_entry_ids: string[] | null;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity: EventSeverity;

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
