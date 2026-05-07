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
import {
  SuggestionGenerationJobStatus,
  SuggestionRequestSource,
} from '../suggestions.constants';
import { SuggestionInstance } from './suggestion-instance.entity';

const ACTIVE_JOB_STATUS_INDEX_WHERE = `"status" IN ('${SuggestionGenerationJobStatus.Queued}','${SuggestionGenerationJobStatus.Running}')`;
const SCHEDULED_JOB_INDEX_WHERE = `"request_source" = '${SuggestionRequestSource.Scheduled}' AND "slot_id" IS NOT NULL`;
const ON_DEMAND_JOB_INDEX_WHERE = `"request_source" = '${SuggestionRequestSource.OnDemand}' AND "suggestion_instance_id" IS NOT NULL`;

@Entity('suggestion_generation_jobs')
@Index('IDX_suggestion_jobs_status_run_after', ['status', 'run_after'], {
  where: ACTIVE_JOB_STATUS_INDEX_WHERE,
})
@Index(
  'UQ_suggestion_jobs_scheduled_user_slot_date',
  ['user_id', 'slot_id', 'target_date'],
  {
    unique: true,
    where: SCHEDULED_JOB_INDEX_WHERE,
  },
)
@Index('UQ_suggestion_jobs_on_demand_instance', ['suggestion_instance_id'], {
  unique: true,
  where: ON_DEMAND_JOB_INDEX_WHERE,
})
@Index('IDX_suggestion_jobs_source_status_run_after', [
  'request_source',
  'status',
  'run_after',
])
export class SuggestionGenerationJob {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  slot_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  suggestion_instance_id: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: SuggestionRequestSource.Scheduled,
  })
  request_source: SuggestionRequestSource;

  @Column({ type: 'date' })
  target_date: string;

  @Column({ type: 'time' })
  target_time: string;

  @Column({ type: 'timestamptz' })
  visible_at: Date;

  @Column({
    type: 'varchar',
    length: 20,
    default: SuggestionGenerationJobStatus.Queued,
  })
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

  @ManyToOne(() => ScheduleSlot, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'slot_id' })
  slot: ScheduleSlot | null;

  @ManyToOne(() => SuggestionInstance, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'suggestion_instance_id' })
  suggestion_instance: SuggestionInstance | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
