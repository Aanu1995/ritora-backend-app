import { IngredientIntelligenceService } from '../../ingredients/ingredient-intelligence.service';
import { INGREDIENT_CATEGORY_CONFLICT_RULES } from '../../ingredients/ingredient-safety-rules';
import { buildConflicts } from '../../ingredients/multi-analysis';
import { maybeAdjustSeverity } from '../../ingredients/safety-scorer';
import type {
  AnalysisConflict,
  ConflictRule,
  MatchedIngredient,
  ProductForAnalysis,
  ProductMatchResult,
  RuleSide,
} from '../../ingredients/ingredients.types';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import type { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import type { SuggestionIngredientConflictSummary } from '../suggestion-context.types';
import type { ProductIngredientIntelligence } from './suggestion-product-intelligence';

type PreparedRuleSide = {
  categories: Set<string>;
  ingredientSlugs: Set<string>;
};

type PreparedPairingRule = ConflictRule & {
  leftLookup: PreparedRuleSide;
  rightLookup: PreparedRuleSide;
};

export async function buildIngredientIntelligenceByProductId(
  ingredientIntelligence: IngredientIntelligenceService | undefined,
  products: InventoryProduct[],
  skinProfile: SkinProfile | null = null,
): Promise<Map<string, ProductIngredientIntelligence>> {
  const map = new Map<string, ProductIngredientIntelligence>();
  if (!ingredientIntelligence) return map;

  const matches = await ingredientIntelligence.matchProducts(
    products.map(toAnalysisProduct),
  );
  for (const match of matches) {
    map.set(match.product.id, {
      matchedIngredientCount: match.matchedIngredients.length,
      totalIngredientCount: match.totalTokens,
      conflicts: [],
    });
  }
  const conflicts = buildConflicts(
    matches,
    skinProfile,
    INGREDIENT_CATEGORY_CONFLICT_RULES,
  ).filter(
    (conflict) =>
      conflict.productAId !== conflict.productBId &&
      Boolean(conflict.productAId) &&
      Boolean(conflict.productBId),
  );

  const conflictSummaries = dedupeConflictSummaries(
    conflicts
      .concat(buildActivePairingWarningConflicts(matches, skinProfile))
      .map(toSuggestionConflictSummary),
  );

  for (const summary of conflictSummaries) {
    const productA = map.get(summary.productIds[0]);
    const productB = map.get(summary.productIds[1]);
    if (productA) {
      (productA.conflicts ??= []).push(summary);
    }
    if (productB) {
      (productB.conflicts ??= []).push(summary);
    }
  }
  return map;
}

function toAnalysisProduct(product: InventoryProduct): ProductForAnalysis {
  return {
    id: product.id,
    brand: product.brand,
    name: product.name,
    category: product.category,
    inciIngredients: product.identity?.inciIngredients ?? [],
  };
}

function buildActivePairingWarningConflicts(
  matches: ProductMatchResult[],
  skinProfile: SkinProfile | null,
): AnalysisConflict[] {
  const findings = new Map<string, AnalysisConflict>();
  const rules = INGREDIENT_CATEGORY_CONFLICT_RULES.map(preparePairingRule);

  for (let leftIndex = 0; leftIndex < matches.length; leftIndex += 1) {
    const leftProduct = matches[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < matches.length;
      rightIndex += 1
    ) {
      const rightProduct = matches[rightIndex];
      if (leftProduct.product.id === rightProduct.product.id) continue;

      for (const leftIngredient of leftProduct.matchedIngredients) {
        for (const rightIngredient of rightProduct.matchedIngredients) {
          addActivePairingWarningFinding(
            findings,
            rules,
            skinProfile,
            leftProduct.product.id,
            rightProduct.product.id,
            leftIngredient,
            rightIngredient,
          );
        }
      }
    }
  }

  return Array.from(findings.values()).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function addActivePairingWarningFinding(
  findings: Map<string, AnalysisConflict>,
  rules: PreparedPairingRule[],
  skinProfile: SkinProfile | null,
  productAId: string,
  productBId: string,
  leftIngredient: MatchedIngredient,
  rightIngredient: MatchedIngredient,
): void {
  const rule = matchPairingWarningRule(rules, leftIngredient, rightIngredient);
  if (!rule) return;

  const productIds = [productAId, productBId].sort();
  const ingredientSlugs = [
    leftIngredient.ingredient.slug,
    rightIngredient.ingredient.slug,
  ].sort();
  const key = [
    'active-warning',
    rule.code,
    ...productIds,
    ...ingredientSlugs,
  ].join(':');

  if (findings.has(key)) return;

  const severity = maybeAdjustSeverity(rule.severity, skinProfile, [
    leftIngredient.ingredient.slug,
    leftIngredient.ingredient.category,
    rightIngredient.ingredient.slug,
    rightIngredient.ingredient.category,
  ]);

  findings.set(key, {
    id: key,
    code: rule.code,
    severity,
    ingredientA: leftIngredient.ingredient.displayNameEn,
    ingredientB: rightIngredient.ingredient.displayNameEn,
    productAId,
    productBId,
    conditions: rule.conditions,
    mitigation: rule.mitigationEn,
    description: rule.descriptionEn,
    explanation: null,
  });
}

function matchPairingWarningRule(
  rules: PreparedPairingRule[],
  left: MatchedIngredient,
  right: MatchedIngredient,
): PreparedPairingRule | null {
  for (const rule of rules) {
    const directMatch =
      matchesRuleSide(rule.leftLookup, left) &&
      matchesRuleSide(rule.rightLookup, right);
    const reverseMatch =
      matchesRuleSide(rule.leftLookup, right) &&
      matchesRuleSide(rule.rightLookup, left);

    if (directMatch || reverseMatch) return rule;
  }

  return null;
}

function matchesRuleSide(
  side: PreparedRuleSide,
  ingredient: MatchedIngredient,
): boolean {
  return (
    side.categories.has(ingredient.ingredient.category) ||
    side.ingredientSlugs.has(ingredient.ingredient.slug)
  );
}

function preparePairingRule(rule: ConflictRule): PreparedPairingRule {
  return {
    ...rule,
    leftLookup: prepareRuleSide(rule.left),
    rightLookup: prepareRuleSide(rule.right),
  };
}

function prepareRuleSide(side: RuleSide): PreparedRuleSide {
  return {
    categories: new Set(side.categories ?? []),
    ingredientSlugs: new Set(side.ingredientSlugs ?? []),
  };
}

function dedupeConflictSummaries(
  summaries: SuggestionIngredientConflictSummary[],
): SuggestionIngredientConflictSummary[] {
  const unique = new Map<string, SuggestionIngredientConflictSummary>();

  for (const summary of summaries) {
    const key = [
      summary.code,
      ...summary.productIds,
      ...summary.ingredientNames.slice().sort(),
    ].join(':');
    if (!unique.has(key)) unique.set(key, summary);
  }

  return Array.from(unique.values());
}

function toSuggestionConflictSummary(
  conflict: AnalysisConflict,
): SuggestionIngredientConflictSummary {
  const productIds = [conflict.productAId, conflict.productBId].sort() as [
    string,
    string,
  ];
  return {
    id: conflict.id,
    code: conflict.code,
    severity: conflict.severity,
    productIds,
    ingredientNames: [conflict.ingredientA, conflict.ingredientB],
    description: conflict.description,
    mitigation: conflict.mitigation ?? null,
  };
}
