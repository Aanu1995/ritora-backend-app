import { AnalysisConfidence } from './ingredients.types';
import {
  PRODUCT_COMPARE_REVIEW_CONFIDENCE,
  PRODUCT_COMPARE_REVIEW_REASON_CODES,
  type ParsedProductCompareAiReview,
} from './product-compare-ai-review.schema';
import {
  ProductCompareAiReviewStatus,
  ProductCompareOutcome,
  ProductCompareReasonCode,
  type ProductCompareAiReview,
  type ProductCompareAiReviewInput,
} from './product-compare.types';
import { ProductCheckPersonalizationLevel } from './product-check.types';

const MAX_SUMMARY_CHARS = 320;

export function buildProductCompareAiReviewPayload(
  input: ProductCompareAiReviewInput,
) {
  return {
    language: input.language,
    goal: input.goal,
    context: input.context,
    items: input.items.map((item) => ({
      itemId: item.itemId,
      kind: item.kind,
      category: item.category,
      inciIngredientCount: item.inciIngredientCount,
      matchedIngredientCount: item.matchedIngredientCount,
      confidence: item.confidence,
      safetyScore: item.safetyScore,
      verdict: {
        label: item.verdict.label,
        confidence: item.verdict.confidence,
        safetyScore: item.verdict.safetyScore,
        reasonCodes: item.verdict.reasons.map((reason) => reason.code),
      },
      keyActives: item.keyActives,
      conflictCount: item.conflictCount,
      overlapCount: item.overlapCount,
      reactionEvidenceCount: item.reactionEvidenceCount,
    })),
    deterministicComparison: {
      outcome: input.deterministicComparison.outcome,
      winnerItemId: input.deterministicComparison.winnerItemId,
      confidence: input.deterministicComparison.confidence,
      reasonCodes: input.deterministicComparison.reasons.map(
        (reason) => reason.code,
      ),
    },
    pairwiseOverlaps: input.pairwiseOverlaps.map((overlap) => ({
      leftItemId: overlap.leftItemId,
      rightItemId: overlap.rightItemId,
      ratio: Number(overlap.ratio.toFixed(2)),
      ingredientNames: overlap.ingredientNames.slice(0, 8),
    })),
    pairwiseConflicts: input.pairwiseConflicts.map((conflict) => ({
      leftItemId: conflict.leftItemId,
      rightItemId: conflict.rightItemId,
      code: conflict.code,
      severity: conflict.severity,
      ingredientNames: conflict.ingredientNames.slice(0, 4),
    })),
  };
}

export function sanitizeProductCompareAiReview(
  parsed: ParsedProductCompareAiReview,
  input: ProductCompareAiReviewInput,
): ProductCompareAiReview {
  const allowedItemIds = new Set(input.items.map((item) => item.itemId));
  const allowedReasons = allowedReasonCodes(input);
  const deterministicWinner = input.deterministicComparison.winnerItemId;
  const preferredItemId =
    typeof parsed.preferredItemId === 'string' &&
    parsed.preferredItemId === deterministicWinner &&
    allowedItemIds.has(parsed.preferredItemId) &&
    input.deterministicComparison.outcome !==
      ProductCompareOutcome.NoClearWinner &&
    input.deterministicComparison.outcome !==
      ProductCompareOutcome.NotEnoughData
      ? parsed.preferredItemId
      : null;
  const reasonCodes = unique(
    (parsed.reasonCodes ?? []).filter(
      (code): code is ProductCompareReasonCode =>
        PRODUCT_COMPARE_REVIEW_REASON_CODES.includes(code),
    ),
  ).filter((code) => allowedReasons.has(code));
  const confidence =
    parsed.confidence &&
    PRODUCT_COMPARE_REVIEW_CONFIDENCE.includes(parsed.confidence)
      ? parsed.confidence
      : input.deterministicComparison.confidence;
  const summary =
    typeof parsed.summary === 'string'
      ? parsed.summary.trim().slice(0, MAX_SUMMARY_CHARS) || null
      : null;

  return {
    status: ProductCompareAiReviewStatus.Reviewed,
    confidence,
    preferredItemId,
    reasonCodes,
    summary,
    reviewedAt: new Date().toISOString(),
  };
}

export function unavailableProductCompareAiReview(): ProductCompareAiReview {
  return {
    status: ProductCompareAiReviewStatus.Unavailable,
    confidence: AnalysisConfidence.Low,
    preferredItemId: null,
    reasonCodes: [],
    summary: null,
    reviewedAt: new Date().toISOString(),
  };
}

function allowedReasonCodes(
  input: ProductCompareAiReviewInput,
): Set<ProductCompareReasonCode> {
  const allowed = new Set(
    input.deterministicComparison.reasons.map((reason) => reason.code),
  );

  if (
    input.deterministicComparison.outcome ===
    ProductCompareOutcome.NotEnoughData
  ) {
    allowed.add(ProductCompareReasonCode.NotEnoughData);
  }

  if (input.deterministicComparison.winnerItemId) {
    allowed.add(ProductCompareReasonCode.BetterFit);
    allowed.add(ProductCompareReasonCode.LowerConflict);
    allowed.add(ProductCompareReasonCode.LessDuplicateExposure);
  }

  if (input.items.some((item) => item.reactionEvidenceCount > 0)) {
    allowed.add(ProductCompareReasonCode.ReactionRisk);
  }

  if (input.pairwiseConflicts.length > 0) {
    allowed.add(ProductCompareReasonCode.RoutineConflict);
    allowed.add(ProductCompareReasonCode.UseTogetherCarefully);
  }

  if (
    input.context.level === ProductCheckPersonalizationLevel.Educational ||
    input.context.missingSignals.length > 0
  ) {
    allowed.add(ProductCompareReasonCode.MissingPersonalContext);
  }

  if (input.pairwiseOverlaps.some((overlap) => overlap.ratio >= 0.75)) {
    allowed.add(ProductCompareReasonCode.AlreadyOwned);
    allowed.add(ProductCompareReasonCode.ReplacementOnly);
    allowed.add(ProductCompareReasonCode.SimilarTradeoffs);
  }

  if (
    input.deterministicComparison.outcome ===
    ProductCompareOutcome.NoClearWinner
  ) {
    allowed.add(ProductCompareReasonCode.SimilarTradeoffs);
    allowed.add(ProductCompareReasonCode.DifferentRoutineRoles);
    allowed.add(ProductCompareReasonCode.FillsRoutineGap);
  }

  return allowed;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
