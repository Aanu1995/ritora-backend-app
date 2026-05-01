import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import type { InsightGenerationTrigger } from '../skin-journal.constants';

const encryptedDirtyReasonsTransformer = encryptedJsonFieldTransformer<
  InsightGenerationTrigger[]
>('skin_journal_insight_states.dirty_reasons', []);

@Entity('skin_journal_insight_states')
@Index('IDX_skin_journal_insight_states_dirty_since', ['dirty_since'])
@Index('IDX_skin_journal_insight_states_last_generated', ['last_generated_at'])
@Index('IDX_skin_journal_insight_states_last_failed', ['last_failed_at'])
export class SkinJournalInsightState {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  dirty_since: Date | null;

  @Column({
    type: 'jsonb',
    transformer: encryptedDirtyReasonsTransformer,
  })
  dirty_reasons: InsightGenerationTrigger[];

  @Column({ type: 'varchar', length: 64, nullable: true })
  latest_input_signature: string | null;

  @Column({ type: 'integer', default: 0 })
  latest_entry_count: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  last_generated_signature: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_generated_at: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  last_generation_trigger: InsightGenerationTrigger | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  last_failed_signature: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_failed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_checked_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
