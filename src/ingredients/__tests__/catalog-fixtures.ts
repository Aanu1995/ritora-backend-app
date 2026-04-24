import type { IngredientCatalogService } from '../ingredient-catalog.service';
import {
  AnalysisSeverity,
  IngredientCategory,
} from '../ingredients.types';
import type { ConflictRule, IngredientDefinition } from '../ingredients.types';

type CategoryFallback = {
  pattern: RegExp;
  ingredient: IngredientDefinition;
};

/**
 * Build an in-memory stub of IngredientCatalogService for unit tests.
 * Real DB loading is exercised by the e2e tests and the catalog's own
 * spec — unit tests here use a fixed, curated set.
 */
export function buildStubCatalog(
  options: {
    ingredients?: Partial<IngredientDefinition>[];
    rules?: Partial<ConflictRule>[];
  } = {},
): IngredientCatalogService {
  const ingredients = (options.ingredients ?? DEFAULT_INGREDIENTS).map((raw) =>
    toIngredient(raw),
  );
  const rules = (options.rules ?? DEFAULT_RULES).map(toRule);

  const bySlug = new Map<string, IngredientDefinition>();
  const byAlias = new Map<string, IngredientDefinition>();
  const fallbacks: CategoryFallback[] = [];
  for (const ing of ingredients) {
    bySlug.set(ing.slug, ing);
    for (const alias of ing.aliases) {
      byAlias.set(alias, ing);
    }
    for (const pattern of ing.categoryPatterns) {
      fallbacks.push({ pattern, ingredient: ing });
    }
  }

  return {
    onModuleInit: async () => undefined,
    refresh: async () => undefined,
    getIngredientBySlug: (slug: string) => bySlug.get(slug),
    getIngredientByAlias: (alias: string) => byAlias.get(alias),
    getCategoryFallbacks: () => fallbacks,
    getAllIngredients: () => Array.from(bySlug.values()),
    getConflictRules: () => rules,
  } as unknown as IngredientCatalogService;
}

function toIngredient(raw: Partial<IngredientDefinition>): IngredientDefinition {
  return {
    slug: raw.slug ?? 'unknown',
    displayNameEn: raw.displayNameEn ?? raw.slug ?? 'Unknown',
    summaryEn: raw.summaryEn ?? '',
    category: raw.category ?? IngredientCategory.Antioxidant,
    aliases: raw.aliases ?? [],
    categoryPatterns: raw.categoryPatterns ?? [],
    overlapSeverity: raw.overlapSeverity ?? AnalysisSeverity.Low,
    phMin: raw.phMin,
    phMax: raw.phMax,
    phSensitive: raw.phSensitive,
    photosensitizing: raw.photosensitizing,
    requiresSpf: raw.requiresSpf,
    irritationRisk: raw.irritationRisk,
  };
}

function toRule(raw: Partial<ConflictRule>): ConflictRule {
  return {
    code: raw.code ?? 'UNNAMED_RULE',
    severity: raw.severity ?? AnalysisSeverity.Medium,
    left: raw.left ?? {},
    right: raw.right ?? {},
    descriptionEn: raw.descriptionEn ?? '',
    mitigationEn: raw.mitigationEn,
    conditions: raw.conditions,
    onlyWhenVitaminCIsPhSensitive: raw.onlyWhenVitaminCIsPhSensitive,
  };
}

const DEFAULT_INGREDIENTS: Partial<IngredientDefinition>[] = [
  {
    slug: 'retinol',
    displayNameEn: 'Retinol',
    summaryEn: 'A retinoid that speeds turnover.',
    category: IngredientCategory.Retinoid,
    aliases: ['all-trans-retinol', 'vitamin-a'],
    categoryPatterns: [/\bretinol\b/],
    overlapSeverity: AnalysisSeverity.High,
    phMin: 5,
    phMax: 7,
    photosensitizing: true,
    requiresSpf: true,
    irritationRisk: true,
  },
  {
    slug: 'retinyl-palmitate',
    displayNameEn: 'Retinyl palmitate',
    summaryEn: 'A gentle ester form of vitamin A.',
    category: IngredientCategory.Retinoid,
    aliases: [],
    categoryPatterns: [/\bretinyl(?:-palmitate)?\b/],
    overlapSeverity: AnalysisSeverity.Medium,
  },
  {
    slug: 'retinaldehyde',
    displayNameEn: 'Retinaldehyde',
    summaryEn: 'A mid-potency retinoid.',
    category: IngredientCategory.Retinoid,
    aliases: ['retinal'],
    categoryPatterns: [/\bretin(?:al|aldehyde)\b/],
    overlapSeverity: AnalysisSeverity.High,
  },
  {
    slug: 'glycolic-acid',
    displayNameEn: 'Glycolic acid',
    summaryEn: 'A small-molecule AHA.',
    category: IngredientCategory.Aha,
    aliases: ['hydroxyacetic-acid'],
    categoryPatterns: [/\bglycolic-acid\b/],
    overlapSeverity: AnalysisSeverity.High,
    photosensitizing: true,
    requiresSpf: true,
    irritationRisk: true,
  },
  {
    slug: 'salicylic-acid',
    displayNameEn: 'Salicylic acid',
    summaryEn: 'An oil-soluble BHA.',
    category: IngredientCategory.Bha,
    aliases: [],
    categoryPatterns: [/\bsalicylic-acid\b/],
    overlapSeverity: AnalysisSeverity.High,
    irritationRisk: true,
  },
  {
    slug: 'ascorbic-acid',
    displayNameEn: 'Vitamin C',
    summaryEn: 'Pure L-ascorbic acid.',
    category: IngredientCategory.VitaminC,
    aliases: ['l-ascorbic-acid'],
    categoryPatterns: [/\b(?:l-)?ascorbic-acid\b/],
    overlapSeverity: AnalysisSeverity.Medium,
    phSensitive: true,
  },
  {
    slug: 'ascorbyl-glucoside',
    displayNameEn: 'Ascorbyl glucoside',
    summaryEn: 'A stable vitamin C derivative.',
    category: IngredientCategory.VitaminC,
    aliases: [],
    categoryPatterns: [/\bascorbyl-glucoside\b/],
    overlapSeverity: AnalysisSeverity.Low,
  },
  {
    slug: 'niacinamide',
    displayNameEn: 'Niacinamide',
    summaryEn: 'Vitamin B3.',
    category: IngredientCategory.Niacinamide,
    aliases: [],
    categoryPatterns: [/\bniacinamide\b/],
    overlapSeverity: AnalysisSeverity.Low,
  },
  {
    slug: 'benzoyl-peroxide',
    displayNameEn: 'Benzoyl peroxide',
    summaryEn: 'An antibacterial acne active.',
    category: IngredientCategory.BenzoylPeroxide,
    aliases: ['bpo'],
    categoryPatterns: [/\bbenzoyl-peroxide\b/],
    overlapSeverity: AnalysisSeverity.High,
  },
];

const DEFAULT_RULES: Partial<ConflictRule>[] = [
  {
    code: 'RETINOID_AHA',
    severity: AnalysisSeverity.High,
    left: { categories: [IngredientCategory.Retinoid] },
    right: { categories: [IngredientCategory.Aha] },
    descriptionEn:
      'Retinoids and alpha hydroxy acids in the same routine can raise irritation and barrier stress.',
    mitigationEn: 'Use them on alternate nights.',
  },
  {
    code: 'RETINOID_BHA',
    severity: AnalysisSeverity.High,
    left: { categories: [IngredientCategory.Retinoid] },
    right: { categories: [IngredientCategory.Bha] },
    descriptionEn: 'Retinoid plus salicylic acid can be too aggressive.',
    mitigationEn: 'Alternate use.',
  },
  {
    code: 'BENZOYL_PEROXIDE_RETINOID',
    severity: AnalysisSeverity.High,
    left: { categories: [IngredientCategory.BenzoylPeroxide] },
    right: { categories: [IngredientCategory.Retinoid] },
    descriptionEn: 'Benzoyl peroxide and retinoids can be very irritating together.',
    mitigationEn: 'Use them at different times.',
  },
  {
    code: 'VITAMIN_C_NIACINAMIDE',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.VitaminC] },
    right: { categories: [IngredientCategory.Niacinamide] },
    descriptionEn: 'Pure low-pH vitamin C may be less comfortable with niacinamide.',
    mitigationEn: 'Split them between morning and evening.',
    onlyWhenVitaminCIsPhSensitive: true,
  },
];
