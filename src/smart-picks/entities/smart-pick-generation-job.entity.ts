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
import {
  SmartPicksGenerationJobStatus,
  SmartPicksMode,
} from '../smart-picks.types';

const ACTIVE_JOB_STATUS_INDEX_WHERE = `"status" IN ('${SmartPicksGenerationJobStatus.Queued}','${SmartPicksGenerationJobStatus.Sent}','${SmartPicksGenerationJobStatus.Running}')`;

@Entity('smart_pick_generation_jobs')
@Index(
  'IDX_smart_pick_generation_jobs_status_run_after',
  ['status', 'run_after'],
  {
    where: ACTIVE_JOB_STATUS_INDEX_WHERE,
  },
)
@Index(
  'UQ_smart_pick_generation_jobs_active_hash',
  ['user_id', 'mode', 'inputs_hash'],
  {
    unique: true,
    where: ACTIVE_JOB_STATUS_INDEX_WHERE,
  },
)
@Index('IDX_smart_pick_generation_jobs_user_mode_hash', [
  'user_id',
  'mode',
  'inputs_hash',
  'updated_at',
])
export class SmartPickGenerationJob {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 16 })
  mode: SmartPicksMode;

  @Column({ type: 'varchar', length: 64 })
  inputs_hash: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: SmartPicksGenerationJobStatus.Queued,
  })
  status: SmartPicksGenerationJobStatus;

  @Column({ type: 'integer', default: 0 })
  attempt_count: number;

  @Column({ type: 'integer', default: 3 })
  max_attempts: number;

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

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
