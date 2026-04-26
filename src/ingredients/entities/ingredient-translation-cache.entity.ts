import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Persistent cache for LLM-translated ingredient-intelligence strings.
 *
 * Row lifecycle: created on first cache miss, read on every subsequent
 * cache hit. Source text is never stored directly — only its sha256 hash,
 * because the English source already lives on the ingredient / rule row.
 * When a source changes (so does its hash), old rows become unreachable
 * naturally; a periodic prune job can remove them. Truncating this table
 * is always safe — the TranslationService will repopulate.
 */
@Entity('ingredient_translation_cache')
@Index('IDX_ingredient_translation_cache_language', ['language'])
export class IngredientTranslationCache {
  @PrimaryColumn({ type: 'char', length: 64 })
  source_hash: string;

  @PrimaryColumn({ type: 'varchar', length: 8 })
  language: string;

  @Column({ type: 'text' })
  translated_text: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
