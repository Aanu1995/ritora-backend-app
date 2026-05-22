import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ProductCompareItemResult } from './product-compare.types';
import type { ResolvedCompareItem } from './product-compare-internal.types';
import {
  ProductCheckSource,
  ProductCheckVerdict,
  type ProductCheckEvaluation,
  type ProductCheckProductInput,
} from './product-check.types';
import { normalizeIngredientList } from './product-check.utils';
import { AnalysisConfidence } from './ingredients.types';

const KEY_ACTIVE_LIMIT = 5;

export function inventoryProductToCompareInput(
  product: InventoryProduct,
): ProductCheckProductInput {
  return {
    source: ProductCheckSource.IngredientPaste,
    brand: product.identity?.brand || product.brand,
    name: product.identity?.name || product.name,
    category: product.identity?.category || product.category,
    inciIngredients: normalizeIngredientList(
      product.identity?.inciIngredients ?? [],
    ),
    reviewRequired: false,
  };
}

export function toProductCompareItemResult(
  item: ResolvedCompareItem,
  evaluation: ProductCheckEvaluation,
): ProductCompareItemResult {
  return {
    itemId: item.itemId,
    kind: item.kind,
    productId: item.productId,
    brand: item.product.brand?.trim() ?? '',
    name: item.product.name?.trim() || 'Checked product',
    category: item.product.category,
    inciIngredientCount: item.product.inciIngredients.length,
    matchedIngredientCount: evaluation.match.matchedIngredients.length,
    confidence: evaluation.response.verdict.confidence,
    safetyScore: evaluation.response.verdict.safetyScore,
    verdict: evaluation.response.verdict,
    keyActives: evaluation.response.analysis.actives
      .map((active) => active.displayName)
      .slice(0, KEY_ACTIVE_LIMIT),
    conflictCount: evaluation.response.analysis.conflicts.length,
    overlapCount: evaluation.response.analysis.overlaps.length,
    reactionEvidenceCount: evaluation.response.reactionEvidence.length,
  };
}

export function scoreProductCompareItem(
  item: ProductCompareItemResult,
): number {
  const score =
    verdictScore(item.verdict.label) +
    (item.safetyScore ?? 0) / 4 -
    item.conflictCount * 6 -
    item.overlapCount * 4 -
    item.reactionEvidenceCount * 12;

  if (item.confidence === AnalysisConfidence.Low) {
    return score - 25;
  }

  if (item.confidence === AnalysisConfidence.Medium) {
    return score - 8;
  }

  return score;
}

function verdictScore(verdict: ProductCheckVerdict): number {
  switch (verdict) {
    case ProductCheckVerdict.GoodFit:
      return 100;
    case ProductCheckVerdict.GoodWithLimits:
      return 82;
    case ProductCheckVerdict.IngredientsOnly:
      return 58;
    case ProductCheckVerdict.UseCarefully:
      return 52;
    case ProductCheckVerdict.AvoidForProfile:
      return 12;
    case ProductCheckVerdict.NotEnoughData:
      return 0;
  }
}
