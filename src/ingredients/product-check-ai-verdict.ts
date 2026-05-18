import { AnalysisConfidence, AnalysisSeverity } from './ingredients.types';
import {
  ProductCheckAiReviewStatus,
  ProductCheckReasonCode,
  ProductCheckVerdict,
  type ProductCheckAiReview,
  type ProductCheckReason,
} from './product-check.types';

const VERDICT_RISK_ORDER: Record<ProductCheckVerdict, number> = {
  [ProductCheckVerdict.GoodFit]: 0,
  [ProductCheckVerdict.GoodWithLimits]: 1,
  [ProductCheckVerdict.IngredientsOnly]: 1,
  [ProductCheckVerdict.UseCarefully]: 2,
  [ProductCheckVerdict.AvoidForProfile]: 3,
  [ProductCheckVerdict.NotEnoughData]: 4,
};

const CONFIDENCE_ORDER: Record<AnalysisConfidence, number> = {
  [AnalysisConfidence.Low]: 0,
  [AnalysisConfidence.Medium]: 1,
  [AnalysisConfidence.High]: 2,
};

export function applyAiReviewLabel(
  baseLabel: ProductCheckVerdict,
  review: ProductCheckAiReview | undefined,
): ProductCheckVerdict {
  if (
    !hasActionableAiReview(review) ||
    !review.suggestedVerdict ||
    baseLabel === ProductCheckVerdict.NotEnoughData ||
    review.suggestedVerdict === ProductCheckVerdict.NotEnoughData
  ) {
    return baseLabel;
  }

  return VERDICT_RISK_ORDER[review.suggestedVerdict] >
    VERDICT_RISK_ORDER[baseLabel]
    ? review.suggestedVerdict
    : baseLabel;
}

export function applyAiReviewConfidence(
  baseConfidence: AnalysisConfidence,
  review: ProductCheckAiReview | undefined,
): AnalysisConfidence {
  if (!hasActionableAiReview(review)) {
    return baseConfidence;
  }

  if (
    review.confidence === AnalysisConfidence.Low &&
    baseConfidence !== AnalysisConfidence.Low &&
    !review.reasonCodes.includes(ProductCheckReasonCode.LowConfidence)
  ) {
    return baseConfidence === AnalysisConfidence.High
      ? AnalysisConfidence.Medium
      : baseConfidence;
  }

  return CONFIDENCE_ORDER[review.confidence] < CONFIDENCE_ORDER[baseConfidence]
    ? review.confidence
    : baseConfidence;
}

export function buildAiReviewReasons(
  review: ProductCheckAiReview | undefined,
): ProductCheckReason[] {
  if (!hasActionableAiReview(review)) {
    return [];
  }

  return review.reasonCodes.map((code) => ({
    code,
    severity: aiReviewReasonSeverity(code),
    ingredientNames: aiReviewIngredientNames(code, review),
    conflictCode: null,
  }));
}

function hasActionableAiReview(
  review: ProductCheckAiReview | undefined,
): review is ProductCheckAiReview {
  return (
    review?.status === ProductCheckAiReviewStatus.Reviewed &&
    (Boolean(review.suggestedVerdict) || review.reasonCodes.length > 0)
  );
}

function aiReviewReasonSeverity(
  code: ProductCheckReasonCode,
): AnalysisSeverity | null {
  if (code === ProductCheckReasonCode.HighConflict) {
    return AnalysisSeverity.High;
  }

  if (
    [
      ProductCheckReasonCode.MediumConflict,
      ProductCheckReasonCode.DuplicateExposure,
      ProductCheckReasonCode.ProductReactionSignal,
      ProductCheckReasonCode.ReactionTrigger,
      ProductCheckReasonCode.SensitiveProfile,
    ].includes(code)
  ) {
    return AnalysisSeverity.Medium;
  }

  if (
    [
      ProductCheckReasonCode.LowConflict,
      ProductCheckReasonCode.PhotosensitizingActive,
    ].includes(code)
  ) {
    return AnalysisSeverity.Low;
  }

  return null;
}

function aiReviewIngredientNames(
  code: ProductCheckReasonCode,
  review: ProductCheckAiReview,
): string[] {
  if (
    [
      ProductCheckReasonCode.HighConflict,
      ProductCheckReasonCode.MediumConflict,
      ProductCheckReasonCode.LowConflict,
      ProductCheckReasonCode.DuplicateExposure,
      ProductCheckReasonCode.ProductReactionSignal,
      ProductCheckReasonCode.ReactionTrigger,
      ProductCheckReasonCode.PhotosensitizingActive,
    ].includes(code)
  ) {
    return review.ingredientNames;
  }

  return [];
}
