import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import type { InsightAction } from '../insights/insight-types';
import type { InsightInteractionType } from '../skin-journal.constants';

@Entity('skin_journal_insight_interactions')
@Index('IDX_skin_journal_insight_interactions_user_created', [
  'user_id',
  'created_at',
])
@Index('IDX_skin_journal_insight_interactions_insight_type', [
  'insight_id',
  'interaction_type',
])
export class SkinJournalInsightInteraction {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  insight_id: string;

  @Column({ type: 'varchar', length: 32 })
  interaction_type: InsightInteractionType;

  @Column({ type: 'varchar', length: 40, nullable: true })
  action_kind: InsightAction['kind'] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
