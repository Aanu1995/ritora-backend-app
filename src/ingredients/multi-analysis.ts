import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SEVERITY_ORDER } from './analysis.constants';
import { maybeAdjustSeverity } from './safety-scorer';
import type {
  AnalysisConflict,
  AnalysisOverlap,
  ConflictRule,
  MatchedIngredient,
  ProductMatchResult,
  RuleSide,
} from './ingredients.types';

const OVERLAP_DESCRIPTION_EN = (ingredient: string) =>
  `${ingredient} appears in more than one product in this routine, which can raise cumulative exposure.`;

type PreparedRuleSide = {
  categories: Set<string>;
  ingredientSlugs: Set<string>;
};

type PreparedRule = ConflictRule & {
  leftLookup: PreparedRuleSide;
  rightLookup: PreparedRuleSide;
};

export function buildConflicts(
  matches: ProductMatchResult[],
  skinProfile: SkinProfile | null,
  rules: ConflictRule[],
): AnalysisConflict[] {
  const findings = new Map<string, AnalysisConflict>();
  const preparedRules = rules.map(prepareRule);

  for (let productIndex = 0; productIndex < matches.length; productIndex += 1) {
    const leftProduct = matches[productIndex];
    for (
      let comparisonIndex = productIndex;
      comparisonIndex < matches.length;
      comparisonIndex += 1
    ) {
      const rightProduct = matches[comparisonIndex];
      if (leftProduct.product.id === rightProduct.product.id) {
        for (
          let leftIndex = 0;
          leftIndex < leftProduct.matchedIngredients.length;
          leftIndex += 1
        ) {
          for (
            let rightIndex = leftIndex + 1;
            rightIndex < leftProduct.matchedIngredients.length;
            rightIndex += 1
          ) {
            addConflictFinding(
              findings,
              preparedRules,
              skinProfile,
              leftProduct.product.id,
              rightProduct.product.id,
              leftProduct.matchedIngredients[leftIndex],
              leftProduct.matchedIngredients[rightIndex],
            );
          }
        }
        continue;
      }

      for (const leftIngredient of leftProduct.matchedIngredients) {
        for (const rightIngredient of rightProduct.matchedIngredients) {
          addConflictFinding(
            findings,
            preparedRules,
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

function addConflictFinding(
  findings: Map<string, AnalysisConflict>,
  rules: PreparedRule[],
  skinProfile: SkinProfile | null,
  productAId: string,
  productBId: string,
  leftIngredient: MatchedIngredient,
  rightIngredient: MatchedIngredient,
): void {
  const rule = matchConflictRule(rules, leftIngredient, rightIngredient);
  if (!rule) return;

  const key = [
    rule.code,
    productAId,
    productBId,
    leftIngredient.ingredient.slug,
    rightIngredient.ingredient.slug,
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

function matchConflictRule(
  rules: PreparedRule[],
  left: MatchedIngredient,
  right: MatchedIngredient,
): PreparedRule | null {
  for (const rule of rules) {
    const directMatch =
      matchesRuleSide(rule.leftLookup, left) &&
      matchesRuleSide(rule.rightLookup, right);
    const reverseMatch =
      matchesRuleSide(rule.leftLookup, right) &&
      matchesRuleSide(rule.rightLookup, left);

    if (!directMatch && !reverseMatch) continue;

    if (
      rule.onlyWhenVitaminCIsPhSensitive &&
      !left.ingredient.phSensitive &&
      !right.ingredient.phSensitive
    ) {
      continue;
    }

    return rule;
  }

  return null;
}

function matchesRuleSide(
  side: PreparedRuleSide,
  ingredient: MatchedIngredient,
): boolean {
  if (side.categories.has(ingredient.ingredient.category)) return true;
  if (side.ingredientSlugs.has(ingredient.ingredient.slug)) return true;
  return false;
}

function prepareRule(rule: ConflictRule): PreparedRule {
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
