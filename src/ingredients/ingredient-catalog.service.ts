import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  ConflictRule,
  IngredientCategory,
  IngredientDefinition,
  AnalysisSeverity,
  RuleSide,
} from './ingredients.types';

type IngredientRow = {
  slug: string;
  category: IngredientCategory;
  display_name_en: string;
  summary_en: string;
  ph_min: string | null;
  ph_max: string | null;
  ph_sensitive: boolean;
  photosensitizing: boolean;
  requires_spf: boolean;
  irritation_risk: boolean;
  overlap_severity: AnalysisSeverity;
};

type AliasRow = {
  ingredient_slug: string;
  alias_slug: string;
};

type PatternRow = {
  ingredient_slug: string;
  pattern: string;
};

type ConflictRow = {
  code: string;
  severity: AnalysisSeverity;
  left_categories: IngredientCategory[] | null;
  left_ingredient_slugs: string[] | null;
  right_categories: IngredientCategory[] | null;
  right_ingredient_slugs: string[] | null;
  description_en: string;
  mitigation_en: string | null;
  conditions: Record<string, unknown>;
  only_when_vitamin_c_is_ph_sensitive: boolean;
};

type CategoryFallback = {
  pattern: RegExp;
  ingredient: IngredientDefinition;
};

/**
 * Loads the full ingredient + conflict-rule catalogue from Postgres into
 * an in-memory cache on boot. Everything the matcher and analyser need
 * flows through this one service — no hardcoded arrays anywhere.
 *
 * `refresh()` rebuilds the cache. Called automatically after the seeder
 * runs at app boot and exposed for tests.
 */
@Injectable()
export class IngredientCatalogService {
  private readonly logger = new Logger(IngredientCatalogService.name);

  private ingredientsBySlug = new Map<string, IngredientDefinition>();
  private ingredientsByAlias = new Map<string, IngredientDefinition>();
  private categoryFallbacks: CategoryFallback[] = [];
  private conflictRules: ConflictRule[] = [];

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async refresh(): Promise<void> {
    try {
      await this.loadFromDatabase();
    } catch (error) {
      this.logger.warn(
        `Ingredient catalogue refresh skipped: ${
          error instanceof Error ? error.message : 'unknown error'
        }. Cache stays as-is; a later refresh will repopulate.`,
      );
    }
  }

  private async loadFromDatabase(): Promise<void> {
    const [ingredients, aliases, patterns, rules] = await Promise.all([
      this.dataSource.query<IngredientRow[]>(
        `SELECT slug, category, display_name_en, summary_en, ph_min, ph_max,
                ph_sensitive, photosensitizing, requires_spf, irritation_risk,
                overlap_severity
         FROM ingredient_entries`,
      ),
      this.dataSource.query<AliasRow[]>(
        `SELECT ingredient_slug, alias_slug FROM ingredient_aliases`,
      ),
      this.dataSource.query<PatternRow[]>(
        `SELECT ingredient_slug, pattern FROM ingredient_category_patterns`,
      ),
      this.dataSource.query<ConflictRow[]>(
        `SELECT code, severity, left_categories, left_ingredient_slugs,
                right_categories, right_ingredient_slugs,
                description_en, mitigation_en,
                conditions, only_when_vitamin_c_is_ph_sensitive
         FROM ingredient_conflict_rules`,
      ),
    ]);

    const aliasesBySlug = groupBy(aliases, (row) => row.ingredient_slug);
    const patternsBySlug = groupBy(patterns, (row) => row.ingredient_slug);

    const ingredientDefs: IngredientDefinition[] = ingredients.map((row) => ({
      slug: row.slug,
      displayNameEn: row.display_name_en,
      summaryEn: row.summary_en,
      category: row.category,
      aliases: (aliasesBySlug.get(row.slug) ?? []).map((a) => a.alias_slug),
      categoryPatterns: (patternsBySlug.get(row.slug) ?? []).map(
        (p) => new RegExp(p.pattern),
      ),
      overlapSeverity: row.overlap_severity,
      phMin: row.ph_min === null ? undefined : Number(row.ph_min),
      phMax: row.ph_max === null ? undefined : Number(row.ph_max),
      phSensitive: row.ph_sensitive || undefined,
      photosensitizing: row.photosensitizing || undefined,
      requiresSpf: row.requires_spf || undefined,
      irritationRisk: row.irritation_risk || undefined,
    }));

    const bySlug = new Map<string, IngredientDefinition>();
    const byAlias = new Map<string, IngredientDefinition>();
    const fallbacks: CategoryFallback[] = [];

    for (const ing of ingredientDefs) {
      bySlug.set(ing.slug, ing);
      for (const alias of ing.aliases) {
        byAlias.set(alias, ing);
      }
      for (const pattern of ing.categoryPatterns) {
        fallbacks.push({ pattern, ingredient: ing });
      }
    }

    const ruleDefs: ConflictRule[] = rules.map((row) => {
      const left: RuleSide = {};
      if (row.left_categories?.length) left.categories = row.left_categories;
      if (row.left_ingredient_slugs?.length) {
        left.ingredientSlugs = row.left_ingredient_slugs;
      }
      const right: RuleSide = {};
      if (row.right_categories?.length) right.categories = row.right_categories;
      if (row.right_ingredient_slugs?.length) {
        right.ingredientSlugs = row.right_ingredient_slugs;
      }
      return {
        code: row.code,
        severity: row.severity,
        left,
        right,
        descriptionEn: row.description_en,
        mitigationEn: row.mitigation_en ?? undefined,
        conditions: row.conditions ?? undefined,
        onlyWhenVitaminCIsPhSensitive: row.only_when_vitamin_c_is_ph_sensitive,
      };
    });

    this.ingredientsBySlug = bySlug;
    this.ingredientsByAlias = byAlias;
    this.categoryFallbacks = fallbacks;
    this.conflictRules = ruleDefs;

    this.logger.log(
      `Ingredient catalogue cached: ${bySlug.size} ingredients, ${ruleDefs.length} rules`,
    );
  }

  getIngredientBySlug(slug: string): IngredientDefinition | undefined {
    return this.ingredientsBySlug.get(slug);
  }

  getIngredientByAlias(aliasSlug: string): IngredientDefinition | undefined {
    return this.ingredientsByAlias.get(aliasSlug);
  }

  getCategoryFallbacks(): CategoryFallback[] {
    return this.categoryFallbacks;
  }

  getAllIngredients(): IngredientDefinition[] {
    return Array.from(this.ingredientsBySlug.values());
  }

  getConflictRules(): ConflictRule[] {
    return this.conflictRules;
  }
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}
