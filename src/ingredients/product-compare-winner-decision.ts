import type { AppLanguage } from '../common/i18n/i18n';
import { AnalysisConfidence } from './ingredients.types';
import type { EvaluatedCompareItem } from './product-compare-internal.types';
import {
  ProductCompareGoal,
  ProductCompareOutcome,
  ProductCompareReasonCode,
  type ProductCompareDecision,
  type ProductComparePairwiseConflict,
  type ProductComparePairwiseOverlap,
  type ProductCompareReason,
} from './product-compare.types';
import { productCompareReason } from './product-compare-reasons';
import { productCompareSummaryForOutcome } from './product-compare-summaries';

const HIGH_CONFIDENCE_SCORE_GAP = 28;

export function productCompareWinnerDecision(input: {
  goal: ProductCompareGoal;
  best: EvaluatedCompareItem;
  secondBest: EvaluatedCompareItem;
  scoreGap: number;
  duplicateOverlap: ProductComparePairwiseOverlap | undefined;
  directConflict: ProductComparePairwiseConflict | undefined;
  generatedAt: string;
  language: AppLanguage;
}): ProductCompareDecision {
  const outcome =
    input.best.itemId === 'anchor'
      ? ProductCompareOutcome.ChooseAnchor
      : ProductCompareOutcome.ChooseCandidate;

  return {
    outcome,
    winnerItemId: input.best.itemId,
    confidence:
      input.scoreGap >= HIGH_CONFIDENCE_SCORE_GAP &&
      input.best.result.confidence === AnalysisConfidence.High
        ? AnalysisConfidence.High
        : AnalysisConfidence.Medium,
    summary: productCompareSummaryForOutcome(
      input.goal,
      outcome,
      input.best.result.name,
      input.language,
    ),
    reasons: reasonsForWinner(
      input.best,
      input.secondBest,
      input.duplicateOverlap,
      input.directConflict,
    ),
    generatedAt: input.generatedAt,
  };
}

function reasonsForWinner(
  best: EvaluatedCompareItem,
  secondBest: EvaluatedCompareItem,
  duplicateOverlap: ProductComparePairwiseOverlap | undefined,
  directConflict: ProductComparePairwiseConflict | undefined,
): ProductCompareReason[] {
  const reasons: ProductCompareReason[] = [
    productCompareReason(ProductCompareReasonCode.BetterFit, [best.itemId]),
  ];

  if (duplicateOverlap) {
    reasons.push(
      productCompareReason(
        ProductCompareReasonCode.ReplacementOnly,
        [duplicateOverlap.leftItemId, duplicateOverlap.rightItemId],
        duplicateOverlap.ingredientNames,
      ),
    );
  }

  if (directConflict) {
    reasons.push(
      productCompareReason(
        ProductCompareReasonCode.RoutineConflict,
        [directConflict.leftItemId, directConflict.rightItemId],
        directConflict.ingredientNames,
        directConflict.severity,
      ),
    );
  }

  if (best.result.conflictCount < secondBest.result.conflictCount) {
    reasons.push(
      productCompareReason(ProductCompareReasonCode.LowerConflict, [
        best.itemId,
      ]),
    );
  }

  if (best.result.overlapCount < secondBest.result.overlapCount) {
    reasons.push(
      productCompareReason(ProductCompareReasonCode.LessDuplicateExposure, [
        best.itemId,
      ]),
    );
  }

  if (
    best.result.reactionEvidenceCount < secondBest.result.reactionEvidenceCount
  ) {
    reasons.push(
      productCompareReason(ProductCompareReasonCode.ReactionRisk, [
        secondBest.itemId,
      ]),
    );
  }

  return reasons;
}
