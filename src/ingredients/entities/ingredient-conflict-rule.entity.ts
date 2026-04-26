import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  AnalysisSeverity,
  IngredientCategory,
} from '../ingredients.types';

/**
 * Deterministic conflict rule. The safety verdict is defined here. The LLM
 * only ever paraphrases; it never authors a rule.
 */
@Entity('ingredient_conflict_rules')
export class IngredientConflictRule {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 8 })
  severity: AnalysisSeverity;

  @Column({
    type: 'varchar',
    length: 32,
    array: true,
    nullable: true,
  })
  left_categories: IngredientCategory[] | null;

  @Column({
    type: 'varchar',
    length: 64,
    array: true,
    nullable: true,
  })
  left_ingredient_slugs: string[] | null;

  @Column({
    type: 'varchar',
    length: 32,
    array: true,
    nullable: true,
  })
  right_categories: IngredientCategory[] | null;

  @Column({
    type: 'varchar',
    length: 64,
    array: true,
    nullable: true,
  })
  right_ingredient_slugs: string[] | null;

  @Column({ type: 'text' })
  description_en: string;

  @Column({ type: 'text', nullable: true })
  mitigation_en: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  conditions: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  only_when_vitamin_c_is_ph_sensitive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
