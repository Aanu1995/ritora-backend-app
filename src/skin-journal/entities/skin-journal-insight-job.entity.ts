import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { User } from '../../users/entities/user.entity';
import type {
  InsightGenerationTrigger,
  InsightJobStatus,
} from '../skin-journal.constants';

const ACTIVE_INSIGHT_JOB_STATUSES = "'queued','sent','running'";

@Entity('skin_journal_insight_jobs')
@Index('IDX_skin_journal_insight_jobs_status_run_after', [
  'status',
  'run_after',
])
@Index('IDX_skin_journal_insight_jobs_user_status', ['user_id', 'status'])
@Index('UQ_skin_journal_insight_jobs_active_user', ['user_id'], {
  unique: true,
  where: `"status" IN (${ACTIVE_INSIGHT_JOB_STATUSES})`,
})
export class SkinJournalInsightJob {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 40 })
  trigger: InsightGenerationTrigger;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: InsightJobStatus;

  @Column({ type: 'varchar', length: 10, default: 'en' })
  locale: string;

  @Column({ type: 'varchar', length: 64 })
  input_signature: string;

  @Column({ type: 'integer', default: 0 })
  attempt_count: number;

  @Column({ type: 'integer', default: 5 })
  max_attempts: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  run_after: Date;

  @Column({ type: 'timestamptz', nullable: true })
  locked_at: Date | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  locked_by: string | null;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
