import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { IngredientEntry } from './ingredient-entry.entity';

/**
 * Regex fallback pattern for the matcher. Stored as a string; compiled to a
 * `RegExp` at cache-load time by the IngredientCatalogService.
 */
@Entity('ingredient_category_patterns')
export class IngredientCategoryPattern {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  ingredient_slug: string;

  @PrimaryColumn({ type: 'text' })
  pattern: string;

  @ManyToOne(
    () => IngredientEntry,
    (ingredient) => ingredient.categoryPatterns,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'ingredient_slug' })
  ingredient: IngredientEntry;
}
