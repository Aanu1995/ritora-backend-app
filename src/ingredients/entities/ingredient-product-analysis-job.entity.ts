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
import type { AppLanguage } from '../../common/i18n/i18n';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { User } from '../../users/entities/user.entity';

export enum IngredientProductAnalysisJobStatus {
  Queued = 'queued',
  Sent = 'sent',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

const ACTIVE_INGREDIENT_PRODUCT_ANALYSIS_JOB_WHERE = `"status" IN ('${IngredientProductAnalysisJobStatus.Queued}','${IngredientProductAnalysisJobStatus.Sent}','${IngredientProductAnalysisJobStatus.Running}')`;

@Entity('ingredient_product_analysis_jobs')
@Index(
  'idx_ingredient_product_analysis_jobs_status_run_after',
  ['status', 'run_after'],
  { where: ACTIVE_INGREDIENT_PRODUCT_ANALYSIS_JOB_WHERE },
)
@Index(
  'idx_ingredient_product_analysis_jobs_active_version',
  [
    'user_id',
    'product_id',
    'language',
    'with_explanations',
    'inci_hash',
    'product_updated_at',
  ],
  {
    unique: true,
    where: ACTIVE_INGREDIENT_PRODUCT_ANALYSIS_JOB_WHERE,
  },
)
@Index('idx_ingredient_product_analysis_jobs_product_updated', [
  'product_id',
  'updated_at',
])
export class IngredientProductAnalysisJob {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  product_id: string;

  @Column({ type: 'varchar', length: 5 })
  language: AppLanguage;

  @Column({ type: 'boolean', default: false })
  with_explanations: boolean;

  @Column({ type: 'varchar', length: 64 })
  inci_hash: string;

  @Column({ type: 'timestamptz' })
  product_updated_at: Date;

  @Column({
    type: 'varchar',
    length: 20,
    default: IngredientProductAnalysisJobStatus.Queued,
  })
  status: IngredientProductAnalysisJobStatus;

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

  @Column({ type: 'varchar', length: 500, nullable: true })
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

  @ManyToOne(() => InventoryProduct, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: InventoryProduct;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
