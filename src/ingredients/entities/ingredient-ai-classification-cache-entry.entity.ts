import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { IngredientClassification } from '../ingredient-classifier.port';
import type {
  AnalysisSeverity,
  IngredientCategory,
} from '../ingredients.types';

@Entity('ingredient_ai_classification_cache')
@Index('idx_ingredient_ai_classification_cache_token', [
  'model',
  'contract_version',
  'normalized_token_hash',
])
@Index('idx_ingredient_ai_classification_cache_expires', ['expires_at'])
export class IngredientAiClassificationCacheEntry {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  cache_key: string;

  @Column({ type: 'varchar', length: 120 })
  normalized_token: string;

  @Column({ type: 'varchar', length: 64 })
  normalized_token_hash: string;

  @Column({ type: 'varchar', length: 120 })
  model: string;

  @Column({ type: 'varchar', length: 40 })
  contract_version: string;

  @Column({ type: 'jsonb' })
  classification: IngredientClassification;

  @Column({ type: 'numeric', precision: 4, scale: 3 })
  confidence: string;

  @Column({ type: 'varchar', length: 32 })
  category: IngredientCategory;

  @Column({ type: 'varchar', length: 8 })
  overlap_severity: AnalysisSeverity;

  @Column({ type: 'integer', default: 0 })
  hit_count: number;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_used_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
