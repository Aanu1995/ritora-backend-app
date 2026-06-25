import { IngredientIntelligenceService } from '../../ingredients/ingredient-intelligence.service';
import { INGREDIENT_CATEGORY_CONFLICT_RULES } from '../../ingredients/ingredient-safety-rules';
import { buildConflicts } from '../../ingredients/multi-analysis';
import type {
  AnalysisConflict,
  ProductForAnalysis,
} from '../../ingredients/ingredients.types';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import type { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import type { SuggestionIngredientConflictSummary } from '../suggestion-context.types';
import type { ProductIngredientIntelligence } from './suggestion-product-intelligence';

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
  for (const conflict of conflicts) {
    const summary = toSuggestionConflictSummary(conflict);
    const productA = map.get(conflict.productAId);
    const productB = map.get(conflict.productBId);
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
