import type { AppLanguage } from '../common/i18n/i18n';
import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { AnalysisService } from './analysis.service';
import type { AnalysisConflict, ProductForAnalysis } from './ingredients.types';
import type {
  ProductComparePairwiseConflict,
  ProductComparePairwiseOverlap,
} from './product-compare.types';
import type {
  EvaluatedCompareItem,
  ResolvedCompareItem,
} from './product-compare-internal.types';
import {
  normalizeIngredientList,
  normalizeSignal,
} from './product-check.utils';

export function buildProductComparePairwiseOverlaps(
  items: EvaluatedCompareItem[],
): ProductComparePairwiseOverlap[] {
  const overlaps: ProductComparePairwiseOverlap[] = [];

  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < items.length;
      rightIndex += 1
    ) {
      const left = items[leftIndex];
      const right = items[rightIndex];
      const ingredientNames = sharedIngredientNames(
        left.product.inciIngredients,
        right.product.inciIngredients,
      );
      const denominator = Math.min(
        uniqueIngredientCount(left.product.inciIngredients),
        uniqueIngredientCount(right.product.inciIngredients),
      );

      overlaps.push({
        leftItemId: left.itemId,
        rightItemId: right.itemId,
        ratio: denominator === 0 ? 0 : ingredientNames.length / denominator,
        ingredientNames,
      });
    }
  }

  return overlaps;
}

export async function buildProductComparePairwiseConflicts(input: {
  analysisService: AnalysisService;
  items: ResolvedCompareItem[];
  skinProfile: SkinProfile | null;
  language: AppLanguage;
}): Promise<ProductComparePairwiseConflict[]> {
  const itemIds = new Set(input.items.map((item) => item.itemId));
  const analysis = await input.analysisService.analyze({
    products: input.items.map(toPairwiseAnalysisProduct),
    skinProfile: input.skinProfile,
    language: input.language,
    withExplanations: false,
  });

  return analysis.conflicts
    .filter((conflict) => isDirectPairwiseConflict(conflict, itemIds))
    .map((conflict) => ({
      leftItemId: conflict.productAId,
      rightItemId: conflict.productBId,
      code: conflict.code,
      severity: conflict.severity,
      ingredientNames: uniqueNames([
        conflict.ingredientA,
        conflict.ingredientB,
      ]),
    }));
}

function toPairwiseAnalysisProduct(
  item: ResolvedCompareItem,
): ProductForAnalysis {
  return {
    id: item.itemId,
    brand: item.product.brand?.trim() ?? '',
    name: item.product.name?.trim() || 'Compared product',
    category: item.product.category,
    inciIngredients: normalizeIngredientList(item.product.inciIngredients),
  };
}

function isDirectPairwiseConflict(
  conflict: AnalysisConflict,
  itemIds: ReadonlySet<string>,
): boolean {
  return (
    conflict.productAId !== conflict.productBId &&
    itemIds.has(conflict.productAId) &&
    itemIds.has(conflict.productBId)
  );
}

function sharedIngredientNames(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map(normalizeSignal).filter(Boolean));
  const seen = new Set<string>();
  const shared: string[] = [];

  for (const ingredient of left) {
    const key = normalizeSignal(ingredient);
    if (!key || !rightSet.has(key) || seen.has(key)) {
      continue;
    }

    seen.add(key);
    shared.push(ingredient.trim());
  }

  return shared;
}

function uniqueIngredientCount(values: string[]): number {
  return new Set(values.map(normalizeSignal).filter(Boolean)).size;
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const value of values) {
    const key = normalizeSignal(value);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    names.push(value);
  }

  return names;
}
