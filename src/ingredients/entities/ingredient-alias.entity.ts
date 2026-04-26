import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { IngredientEntry } from './ingredient-entry.entity';

/**
 * Normalised alias token. `alias_slug` is already lowercase-kebab-case so
 * the matcher can look it up directly without re-normalising at runtime.
 */
@Entity('ingredient_aliases')
@Index('IDX_ingredient_aliases_alias', ['alias_slug'])
export class IngredientAlias {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  ingredient_slug: string;

  @PrimaryColumn({ type: 'varchar', length: 128 })
  alias_slug: string;

  @ManyToOne(() => IngredientEntry, (ingredient) => ingredient.aliases, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ingredient_slug' })
  ingredient: IngredientEntry;
}
