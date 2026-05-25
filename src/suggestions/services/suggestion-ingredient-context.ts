import { IngredientIntelligenceService } from '../../ingredients/ingredient-intelligence.service';
import type { ProductForAnalysis } from '../../ingredients/ingredients.types';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import type { ProductIngredientIntelligence } from './suggestion-product-intelligence';

export async function buildIngredientIntelligenceByProductId(
  ingredientIntelligence: IngredientIntelligenceService | undefined,
  products: InventoryProduct[],
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
    });
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
