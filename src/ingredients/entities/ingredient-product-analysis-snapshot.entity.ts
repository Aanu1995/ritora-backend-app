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
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { User } from '../../users/entities/user.entity';
import type { AppLanguage } from '../../common/i18n/i18n';
import type { AnalysisResult } from '../ingredients.types';

export enum IngredientProductAnalysisSnapshotStatus {
  Pending = 'pending',
  Ready = 'ready',
  Partial = 'partial',
  Failed = 'failed',
}

@Entity('ingredient_product_analysis_snapshots')
@Index(
  'idx_ingredient_product_analysis_snapshot_unique',
  ['user_id', 'product_id', 'language', 'with_explanations'],
  { unique: true },
)
@Index('idx_ingredient_product_analysis_snapshot_product', [
  'product_id',
  'updated_at',
])
@Index('idx_ingredient_product_analysis_snapshot_user_status', [
  'user_id',
  'status',
  'updated_at',
])
export class IngredientProductAnalysisSnapshot {
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

  @Column({ type: 'timestamptz' })
  product_updated_at: Date;

  @Column({ type: 'varchar', length: 64 })
  inci_hash: string;

  @Column({ type: 'varchar', length: 20 })
  engine_version: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: IngredientProductAnalysisSnapshotStatus.Pending,
  })
  status: IngredientProductAnalysisSnapshotStatus;

  @Column({ type: 'jsonb', nullable: true })
  result: AnalysisResult | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  last_error: string | null;

  @Column({ type: 'timestamptz' })
  requested_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  analyzed_at: Date | null;

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
