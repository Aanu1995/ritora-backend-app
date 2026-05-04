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
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJobStatus } from '../suggestions.constants';

/**
 * Queue row consumed by the suggestion generation worker. The scheduler
 * inserts one job per (user, slot, date) at the slot's `visible_at` time.
 * The worker claims it via `UPDATE ... SKIP LOCKED`, generates the
 * suggestion, then marks the job completed.
 */
@Entity('suggestion_generation_jobs')
@Index('IDX_suggestion_jobs_status_run_after', ['status', 'run_after'], {
  where: `"status" IN ('queued','running')`,
})
@Index(
  'UQ_suggestion_jobs_user_slot_date',
  ['user_id', 'slot_id', 'target_date'],
  { unique: true },
)
export class SuggestionGenerationJob {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  slot_id: string;

  @Column({ type: 'date' })
  target_date: string;

  @Column({ type: 'time' })
  target_time: string;

  @Column({ type: 'timestamptz' })
  visible_at: Date;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: SuggestionGenerationJobStatus;

  @Column({ type: 'integer', default: 0 })
  attempt_count: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  run_after: Date;

  @Column({ type: 'timestamptz', nullable: true })
  locked_at: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  locked_by: string | null;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => ScheduleSlot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slot_id' })
  slot: ScheduleSlot;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
