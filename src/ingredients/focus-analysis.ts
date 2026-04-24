import type {
  AnalysisActive,
  ConflictRule,
  IngredientCategory,
  IngredientDefinition,
  MatchedIngredient,
} from './ingredients.types';

export function buildActives(
  matches: MatchedIngredient[],
  rules: ConflictRule[],
): AnalysisActive[] {
  return matches.map((match) => {
    const ingredient = match.ingredient;
    const avoidCategories = new Set<IngredientCategory>();
    const avoidIngredientSlugs = new Set<string>();
    let mitigationHint: string | null = null;

    for (const rule of rules) {
      const onLeft = ingredientOnSide(ingredient, rule.left);
      const onRight = ingredientOnSide(ingredient, rule.right);
      if (!onLeft && !onRight) continue;

      const otherSide = onLeft ? rule.right : rule.left;
      for (const category of otherSide.categories ?? []) {
        if (category !== ingredient.category) avoidCategories.add(category);
      }
      for (const slug of otherSide.ingredientSlugs ?? []) {
        if (slug !== ingredient.slug) avoidIngredientSlugs.add(slug);
      }

      if (!mitigationHint && rule.mitigationEn) {
        mitigationHint = rule.mitigationEn;
      }
    }

    return {
      slug: ingredient.slug,
      displayName: ingredient.displayNameEn,
      category: ingredient.category,
      summary: ingredient.summaryEn,
      avoidCategories: Array.from(avoidCategories),
      avoidIngredientSlugs: Array.from(avoidIngredientSlugs),
      mitigationHint,
    };
  });
}

function ingredientOnSide(
  ingredient: IngredientDefinition,
  side: ConflictRule['left'],
): boolean {
  if (side.categories?.includes(ingredient.category)) return true;
  if (side.ingredientSlugs?.includes(ingredient.slug)) return true;
  return false;
}
