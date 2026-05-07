import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import {
  MediaDeletionJobStatusValue,
  type MediaDeletionJobStatus,
} from '../skin-journal.constants';

@Entity('skin_journal_media_deletion_jobs')
@Index('IDX_skin_journal_media_deletion_jobs_status_run_after', [
  'status',
  'run_after',
])
@Index('IDX_skin_journal_media_deletion_jobs_user_status', [
  'user_id',
  'status',
])
@Index('UQ_skin_journal_media_deletion_jobs_object_key', ['object_key'], {
  unique: true,
})
export class SkinJournalMediaDeletionJob {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  user_id: string | null;

  @Column({ type: 'text' })
  object_key: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: MediaDeletionJobStatusValue.Pending,
  })
  status: MediaDeletionJobStatus;

  @Column({ type: 'integer', default: 0 })
  attempt_count: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  run_after: Date;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verified_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
