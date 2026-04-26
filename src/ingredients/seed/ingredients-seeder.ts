import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  AnalysisSeverity,
  IngredientCategory,
} from '../ingredients.types';

type SeedIngredient = {
  slug: string;
  category: IngredientCategory;
  displayNameEn: string;
  summaryEn: string;
  aliases?: string[];
  categoryPatterns?: string[];
  phMin?: number;
  phMax?: number;
  phSensitive?: boolean;
  photosensitizing?: boolean;
  requiresSpf?: boolean;
  irritationRisk?: boolean;
  overlapSeverity: AnalysisSeverity;
};

type SeedConflictRule = {
  code: string;
  severity: AnalysisSeverity;
  leftCategories?: IngredientCategory[];
  leftIngredientSlugs?: string[];
  rightCategories?: IngredientCategory[];
  rightIngredientSlugs?: string[];
  descriptionEn: string;
  mitigationEn?: string;
  conditions?: Record<string, unknown>;
  onlyWhenVitaminCIsPhSensitive?: boolean;
};

type SeedPayload = {
  ingredients: SeedIngredient[];
  conflictRules: SeedConflictRule[];
};

/**
 * Idempotent seeder. Reads `ingredients-seed.json` and upserts every row
 * into Postgres inside a single transaction.
 *
 * Not invoked by the app at boot — migrations and seeding run out-of-band
 * before launch via `npm run migration:run` + `npm run ingredients:seed`.
 * Tests still call it explicitly from `test-setup.ts`.
 */
@Injectable()
export class IngredientsSeeder {
  private readonly logger = new Logger(IngredientsSeeder.name);

  constructor(private readonly dataSource: DataSource) {}

  async run(): Promise<void> {
    const payload = this.loadSeed();
    await this.dataSource.transaction(async (manager) => {
      // Ingredients
      for (const ing of payload.ingredients) {
        await manager.query(
          `INSERT INTO ingredient_entries (
            slug, category, display_name_en, summary_en,
            ph_min, ph_max, ph_sensitive, photosensitizing,
            requires_spf, irritation_risk, overlap_severity
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (slug) DO UPDATE SET
            category = EXCLUDED.category,
            display_name_en = EXCLUDED.display_name_en,
            summary_en = EXCLUDED.summary_en,
            ph_min = EXCLUDED.ph_min,
            ph_max = EXCLUDED.ph_max,
            ph_sensitive = EXCLUDED.ph_sensitive,
            photosensitizing = EXCLUDED.photosensitizing,
            requires_spf = EXCLUDED.requires_spf,
            irritation_risk = EXCLUDED.irritation_risk,
            overlap_severity = EXCLUDED.overlap_severity,
            updated_at = now()`,
          [
            ing.slug,
            ing.category,
            ing.displayNameEn,
            ing.summaryEn,
            ing.phMin ?? null,
            ing.phMax ?? null,
            ing.phSensitive ?? false,
            ing.photosensitizing ?? false,
            ing.requiresSpf ?? false,
            ing.irritationRisk ?? false,
            ing.overlapSeverity,
          ],
        );

        // Aliases — delete + reinsert to stay consistent with seed
        await manager.query(
          `DELETE FROM ingredient_aliases WHERE ingredient_slug = $1`,
          [ing.slug],
        );
        for (const alias of ing.aliases ?? []) {
          await manager.query(
            `INSERT INTO ingredient_aliases (ingredient_slug, alias_slug)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING`,
            [ing.slug, alias],
          );
        }

        // Patterns — delete + reinsert
        await manager.query(
          `DELETE FROM ingredient_category_patterns WHERE ingredient_slug = $1`,
          [ing.slug],
        );
        for (const pattern of ing.categoryPatterns ?? []) {
          await manager.query(
            `INSERT INTO ingredient_category_patterns (ingredient_slug, pattern)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING`,
            [ing.slug, pattern],
          );
        }
      }

      // Conflict rules
      for (const rule of payload.conflictRules) {
        await manager.query(
          `INSERT INTO ingredient_conflict_rules (
            code, severity,
            left_categories, left_ingredient_slugs,
            right_categories, right_ingredient_slugs,
            description_en, mitigation_en,
            conditions, only_when_vitamin_c_is_ph_sensitive
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (code) DO UPDATE SET
            severity = EXCLUDED.severity,
            left_categories = EXCLUDED.left_categories,
            left_ingredient_slugs = EXCLUDED.left_ingredient_slugs,
            right_categories = EXCLUDED.right_categories,
            right_ingredient_slugs = EXCLUDED.right_ingredient_slugs,
            description_en = EXCLUDED.description_en,
            mitigation_en = EXCLUDED.mitigation_en,
            conditions = EXCLUDED.conditions,
            only_when_vitamin_c_is_ph_sensitive = EXCLUDED.only_when_vitamin_c_is_ph_sensitive,
            updated_at = now()`,
          [
            rule.code,
            rule.severity,
            rule.leftCategories ?? null,
            rule.leftIngredientSlugs ?? null,
            rule.rightCategories ?? null,
            rule.rightIngredientSlugs ?? null,
            rule.descriptionEn,
            rule.mitigationEn ?? null,
            JSON.stringify(rule.conditions ?? {}),
            rule.onlyWhenVitaminCIsPhSensitive ?? false,
          ],
        );
      }
    });

    this.logger.log(
      `Ingredient seed applied: ${payload.ingredients.length} ingredients, ${payload.conflictRules.length} rules`,
    );
  }

  private loadSeed(): SeedPayload {
    const path = join(__dirname, 'ingredients-seed.json');
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as SeedPayload;
  }
}
