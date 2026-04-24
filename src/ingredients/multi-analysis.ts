import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SEVERITY_ORDER } from './analysis.constants';
import { maybeAdjustSeverity } from './safety-scorer';
import type {
  AnalysisConflict,
  AnalysisOverlap,
  ConflictRule,
  MatchedIngredient,
  ProductMatchResult,
} from './ingredients.types';

const OVERLAP_DESCRIPTION_EN = (ingredient: string) =>
  `${ingredient} appears in more than one product in this routine, which can raise cumulative exposure.`;

export function buildConflicts(
  matches: ProductMatchResult[],
  skinProfile: SkinProfile | null,
  rules: ConflictRule[],
): AnalysisConflict[] {
  const findings = new Map<string, AnalysisConflict>();

  for (let productIndex = 0; productIndex < matches.length; productIndex += 1) {
    const leftProduct = matches[productIndex];
    for (
      let comparisonIndex = productIndex;
      comparisonIndex < matches.length;
      comparisonIndex += 1
    ) {
      const rightProduct = matches[comparisonIndex];
      const pairs =
        leftProduct.product.id === rightProduct.product.id
          ? buildSameProductPairs(leftProduct.matchedIngredients)
          : buildCrossProductPairs(
              leftProduct.matchedIngredients,
              rightProduct.matchedIngredients,
            );

      for (const [leftIngredient, rightIngredient] of pairs) {
        const rule = matchConflictRule(rules, leftIngredient, rightIngredient);
        if (!rule) continue;

        const productAId = leftProduct.product.id;
        const productBId = rightProduct.product.id;
        const key = [
          rule.code,
          productAId,
          productBId,
          leftIngredient.ingredient.slug,
          rightIngredient.ingredient.slug,
        ].join(':');

        if (findings.has(key)) continue;

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
    }
  }

  return sortConflicts(Array.from(findings.values()));
}

export function buildOverlaps(
  matches: ProductMatchResult[],
  skinProfile: SkinProfile | null,
): AnalysisOverlap[] {
  const overlaps = new Map<
    string,
    { productIds: Set<string>; ingredient: MatchedIngredient }
  >();

  for (const match of matches) {
    for (const ingredient of match.matchedIngredients) {
      const current = overlaps.get(ingredient.ingredient.slug);
      if (current) {
        current.productIds.add(match.product.id);
        continue;
      }

      overlaps.set(ingredient.ingredient.slug, {
        productIds: new Set([match.product.id]),
        ingredient,
      });
    }
  }

  const findings = Array.from(overlaps.values())
    .filter(({ productIds }) => productIds.size >= 2)
    .map(({ productIds, ingredient }) => {
      const displayName = ingredient.ingredient.displayNameEn;
      return {
        id: `${ingredient.ingredient.slug}:${Array.from(productIds).sort().join(',')}`,
        ingredient: displayName,
        productIds: Array.from(productIds).sort(),
        severity: maybeAdjustSeverity(
          ingredient.ingredient.overlapSeverity,
          skinProfile,
          [ingredient.ingredient.slug, ingredient.ingredient.category],
        ),
        explanation: null,
        description: OVERLAP_DESCRIPTION_EN(displayName),
      };
    });

  return sortOverlaps(findings);
}

function matchConflictRule(
  rules: ConflictRule[],
  left: MatchedIngredient,
  right: MatchedIngredient,
): ConflictRule | null {
  for (const rule of rules) {
    const directMatch =
      matchesRuleSide(rule.left, left) && matchesRuleSide(rule.right, right);
    const reverseMatch =
      matchesRuleSide(rule.left, right) && matchesRuleSide(rule.right, left);

    if (!directMatch && !reverseMatch) continue;

    if (
      rule.onlyWhenVitaminCIsPhSensitive &&
      !left.ingredient.phSensitive &&
      !right.ingredient.phSensitive
    ) {
      continue;
    }

    return directMatch ? rule : reverseRule(rule);
  }

  return null;
}

function matchesRuleSide(
  side: ConflictRule['left'],
  ingredient: MatchedIngredient,
): boolean {
  if (side.categories?.includes(ingredient.ingredient.category)) return true;
  if (side.ingredientSlugs?.includes(ingredient.ingredient.slug)) return true;
  return false;
}

function reverseRule(rule: ConflictRule): ConflictRule {
  return {
    ...rule,
    left: rule.right,
    right: rule.left,
  };
}

function buildSameProductPairs(
  ingredients: MatchedIngredient[],
): Array<[MatchedIngredient, MatchedIngredient]> {
  const pairs: Array<[MatchedIngredient, MatchedIngredient]> = [];
  for (let leftIndex = 0; leftIndex < ingredients.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ingredients.length;
      rightIndex += 1
    ) {
      pairs.push([ingredients[leftIndex], ingredients[rightIndex]]);
    }
  }
  return pairs;
}

function buildCrossProductPairs(
  leftIngredients: MatchedIngredient[],
  rightIngredients: MatchedIngredient[],
): Array<[MatchedIngredient, MatchedIngredient]> {
  const pairs: Array<[MatchedIngredient, MatchedIngredient]> = [];
  for (const leftIngredient of leftIngredients) {
    for (const rightIngredient of rightIngredients) {
      pairs.push([leftIngredient, rightIngredient]);
    }
  }
  return pairs;
}

function sortConflicts(conflicts: AnalysisConflict[]): AnalysisConflict[] {
  return [...conflicts].sort((left, right) => {
    const severityDelta =
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severityDelta !== 0) return severityDelta;
    return `${left.ingredientA}-${left.ingredientB}`.localeCompare(
      `${right.ingredientA}-${right.ingredientB}`,
    );
  });
}

function sortOverlaps(overlaps: AnalysisOverlap[]): AnalysisOverlap[] {
  return [...overlaps].sort((left, right) => {
    const severityDelta =
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severityDelta !== 0) return severityDelta;
    return left.ingredient.localeCompare(right.ingredient);
  });
}
