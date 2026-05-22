import { AnalysisConfidence } from './ingredients.types';
import type { EvaluatedCompareItem } from './product-compare-internal.types';
import {
  ProductCompareAiReviewStatus,
  ProductCompareGoal,
  ProductCompareReasonCode,
  type ProductCompareAiReview,
  type ProductCompareDecision,
  type ProductComparePairwiseConflict,
  type ProductComparePairwiseOverlap,
  type ProductCompareReason,
} from './product-compare.types';
import {
  mostSevereProductCompareConflict,
  productCompareReason,
  uniqueProductCompareReasons,
} from './product-compare-reasons';

const DUPLICATE_OVERLAP_RATIO = 0.75;
const SHELF_AI_SUMMARY_FORBIDDEN_PATTERN =
  /\b(buy|buying|purchase|purchasing|cart|checkout|shop|shopping)\b|worth buying|add to shelf|add it|köp|köpa|köper|inköp|handla|köpvärd/i;
const TECHNICAL_ITEM_ID_PATTERN = /\b(?:anchor|candidate-\d+)\b/i;
const AI_ITEM_DESCRIPTOR_PATTERN =
  '(?:\\s+(?:product|item|serum|moisturizer|moisturiser|lotion|cream|toner|exfoliant|treatment|spf|sunscreen))?';

export function applyProductCompareAiReview(input: {
  comparison: ProductCompareDecision;
  aiReview: ProductCompareAiReview;
  items: EvaluatedCompareItem[];
  overlaps: ProductComparePairwiseOverlap[];
  conflicts: ProductComparePairwiseConflict[];
  goal: ProductCompareGoal;
}): ProductCompareDecision {
  if (input.aiReview.status !== ProductCompareAiReviewStatus.Reviewed) {
    return input.comparison;
  }

  const aiReasons = input.aiReview.reasonCodes.map((code) =>
    productCompareReason(
      code,
      input.aiReview.preferredItemId ? [input.aiReview.preferredItemId] : [],
    ),
  );
  const reasons = uniqueProductCompareReasons([
    ...input.comparison.reasons,
    ...aiReasons,
  ]);

  return {
    ...input.comparison,
    confidence: minConfidence(
      input.comparison.confidence,
      input.aiReview.confidence,
    ),
    summary: resolveAiReviewSummary(
      input.aiReview,
      input.comparison,
      input.items,
      input.goal,
    ),
    reasons: uniqueProductCompareReasons(
      enrichConflictReasons(
        enrichDuplicateReasons(reasons, input.overlaps),
        input.conflicts,
      ),
    ),
  };
}

function resolveAiReviewSummary(
  aiReview: ProductCompareAiReview,
  comparison: ProductCompareDecision,
  items: EvaluatedCompareItem[],
  goal: ProductCompareGoal,
): string {
  const fallback = comparison.summary;
  const summary = humanizeAiReviewSummary(
    aiReview.summary?.trim() ?? '',
    items,
  );
  if (!summary) {
    return fallback;
  }

  if (
    goal === ProductCompareGoal.ShelfRoutineDecision &&
    SHELF_AI_SUMMARY_FORBIDDEN_PATTERN.test(summary)
  ) {
    return fallback;
  }

  if (TECHNICAL_ITEM_ID_PATTERN.test(summary)) {
    return fallback;
  }

  return summary;
}

function humanizeAiReviewSummary(
  summary: string,
  items: EvaluatedCompareItem[],
): string {
  return items.reduce((current, item) => {
    const label = item.result.name || fallbackItemLabel(item.itemId);
    return current.replace(
      new RegExp(
        `\\b${escapeRegExp(item.itemId)}${AI_ITEM_DESCRIPTOR_PATTERN}\\b`,
        'gi',
      ),
      label,
    );
  }, summary);
}

function enrichDuplicateReasons(
  reasons: ProductCompareReason[],
  overlaps: ProductComparePairwiseOverlap[],
): ProductCompareReason[] {
  const duplicateOverlap = overlaps.find(
    (overlap) => overlap.ratio >= DUPLICATE_OVERLAP_RATIO,
  );
  if (!duplicateOverlap) {
    return reasons;
  }

  return reasons.map((reason) => {
    if (
      reason.code !== ProductCompareReasonCode.AlreadyOwned &&
      reason.code !== ProductCompareReasonCode.ReplacementOnly
    ) {
      return reason;
    }

    return {
      ...reason,
      itemIds:
        reason.itemIds.length > 0
          ? reason.itemIds
          : [duplicateOverlap.leftItemId, duplicateOverlap.rightItemId],
      ingredientNames:
        reason.ingredientNames.length > 0
          ? reason.ingredientNames
          : duplicateOverlap.ingredientNames,
    };
  });
}

function enrichConflictReasons(
  reasons: ProductCompareReason[],
  conflicts: ProductComparePairwiseConflict[],
): ProductCompareReason[] {
  const directConflict = mostSevereProductCompareConflict(conflicts);
  if (!directConflict) {
    return reasons;
  }

  return reasons.map((reason) => {
    if (
      reason.code !== ProductCompareReasonCode.RoutineConflict &&
      reason.code !== ProductCompareReasonCode.UseTogetherCarefully
    ) {
      return reason;
    }

    return {
      ...reason,
      itemIds:
        reason.itemIds.length > 0
          ? reason.itemIds
          : [directConflict.leftItemId, directConflict.rightItemId],
      ingredientNames:
        reason.ingredientNames.length > 0
          ? reason.ingredientNames
          : directConflict.ingredientNames,
      severity: reason.severity ?? directConflict.severity,
    };
  });
}

function minConfidence(
  left: AnalysisConfidence,
  right: AnalysisConfidence,
): AnalysisConfidence {
  const rank = {
    [AnalysisConfidence.Low]: 0,
    [AnalysisConfidence.Medium]: 1,
    [AnalysisConfidence.High]: 2,
  };

  return rank[left] <= rank[right] ? left : right;
}

function fallbackItemLabel(itemId: string): string {
  return itemId === 'anchor' ? 'the checked product' : 'the shelf product';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
