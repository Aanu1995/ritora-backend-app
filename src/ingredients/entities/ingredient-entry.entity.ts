import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  AnalysisSeverity,
  IngredientCategory,
} from '../ingredients.types';
import { IngredientAlias } from './ingredient-alias.entity';
import { IngredientCategoryPattern } from './ingredient-category-pattern.entity';

/**
 * Canonical ingredient row. English-only by design — every other language
 * is produced at runtime via the TranslationService + translation cache.
 */
@Entity('ingredient_entries')
export class IngredientEntry {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 32 })
  category: IngredientCategory;

  @Column({ type: 'varchar', length: 128 })
  display_name_en: string;

  @Column({ type: 'text' })
  summary_en: string;

  @Column({ type: 'numeric', precision: 3, scale: 1, nullable: true })
  ph_min: string | null;

  @Column({ type: 'numeric', precision: 3, scale: 1, nullable: true })
  ph_max: string | null;

  @Column({ type: 'boolean', default: false })
  ph_sensitive: boolean;

  @Column({ type: 'boolean', default: false })
  photosensitizing: boolean;

  @Column({ type: 'boolean', default: false })
  requires_spf: boolean;

  @Column({ type: 'boolean', default: false })
  irritation_risk: boolean;

  @Column({ type: 'varchar', length: 8 })
  overlap_severity: AnalysisSeverity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => IngredientAlias, (alias) => alias.ingredient)
  aliases: IngredientAlias[];

  @OneToMany(() => IngredientCategoryPattern, (pattern) => pattern.ingredient)
  categoryPatterns: IngredientCategoryPattern[];
}
