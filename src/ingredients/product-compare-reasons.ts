import { AnalysisSeverity } from './ingredients.types';
import {
  ProductCompareReasonCode,
  type ProductComparePairwiseConflict,
  type ProductCompareReason,
} from './product-compare.types';

const SEVERITY_RANK: Record<AnalysisSeverity, number> = {
  [AnalysisSeverity.Low]: 1,
  [AnalysisSeverity.Medium]: 2,
  [AnalysisSeverity.High]: 3,
};

export function productCompareReason(
  code: ProductCompareReasonCode,
  itemIds: string[],
  ingredientNames: string[] = [],
  severity: AnalysisSeverity | null = null,
): ProductCompareReason {
  return {
    code,
    itemIds,
    ingredientNames,
    severity,
  };
}

export function uniqueProductCompareReasons(
  reasons: ProductCompareReason[],
): ProductCompareReason[] {
  const seen = new Set<string>();
  const unique: ProductCompareReason[] = [];

  for (const reason of reasons) {
    const key = [
      reason.code,
      [...reason.itemIds].sort().join('|'),
      [...reason.ingredientNames].sort().join('|'),
    ].join(':');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(reason);
  }

  return unique.slice(0, 4);
}

export function mostSevereProductCompareConflict(
  conflicts: ProductComparePairwiseConflict[],
): ProductComparePairwiseConflict | undefined {
  return [...conflicts].sort(
    (left, right) =>
      SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity],
  )[0];
}
