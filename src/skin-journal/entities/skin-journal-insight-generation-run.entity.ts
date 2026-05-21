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
  InsightGenerationStatusValue,
  type InsightGenerationStatus,
  type InsightGenerationTrigger,
} from '../skin-journal.constants';

@Entity('skin_journal_insight_generation_runs')
@Index('IDX_skin_journal_insight_runs_user_created', ['user_id', 'created_at'])
export class SkinJournalInsightGenerationRun {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 40 })
  trigger: InsightGenerationTrigger;

  @Column({
    type: 'varchar',
    length: 20,
    default: InsightGenerationStatusValue.Running,
  })
  status: InsightGenerationStatus;

  @Column({ type: 'date' })
  data_window_start: string;

  @Column({ type: 'date' })
  data_window_end: string;

  @Column({ type: 'timestamptz' })
  data_cutoff_at: Date;

  @Column({ type: 'integer', default: 0 })
  insight_count: number;

  @Column({ type: 'integer', default: 0 })
  duration_ms: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  ai_model: string | null;

  @Column({ type: 'integer', nullable: true })
  ai_input_tokens: number | null;

  @Column({ type: 'integer', nullable: true })
  ai_output_tokens: number | null;

  @Column({ type: 'integer', nullable: true })
  ai_total_tokens: number | null;

  @Column({ type: 'double precision', nullable: true })
  ai_estimated_cost_usd: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
