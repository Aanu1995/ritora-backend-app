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
import { SkinJournalEntry } from './skin-journal-entry.entity';
import {
  AnalysisJobStatus,
  AnalysisJobStatusValue,
} from '../skin-journal.constants';

const ACTIVE_ANALYSIS_JOB_STATUSES = [
  AnalysisJobStatusValue.Queued,
  AnalysisJobStatusValue.Sent,
  AnalysisJobStatusValue.Running,
]
  .map((status) => `'${status}'`)
  .join(',');

@Entity('skin_journal_analysis_jobs')
@Index('IDX_skin_journal_analysis_jobs_status_run_after', [
  'status',
  'run_after',
])
@Index('IDX_skin_journal_analysis_jobs_entry_photo_status', [
  'entry_id',
  'photo_object_key',
  'status',
])
@Index('IDX_skin_journal_analysis_jobs_user_status', ['user_id', 'status'])
@Index(
  'UQ_skin_journal_analysis_jobs_active_entry_photo',
  ['entry_id', 'photo_object_key'],
  {
    unique: true,
    where: `"status" IN (${ACTIVE_ANALYSIS_JOB_STATUSES})`,
  },
)
export class SkinJournalAnalysisJob {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  entry_id: string;

  @Column({ type: 'text' })
  photo_object_key: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: AnalysisJobStatusValue.Queued,
  })
  status: AnalysisJobStatus;

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

  @ManyToOne(() => SkinJournalEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id' })
  entry: SkinJournalEntry;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
