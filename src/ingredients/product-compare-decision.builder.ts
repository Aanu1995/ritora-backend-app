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
import {
  mostSevereProductCompareConflict,
  productCompareReason,
} from './product-compare-reasons';
import {
  productCompareSummaryForDifferentShelfRoles,
  productCompareSummaryForDuplicate,
  productCompareSummaryForNewProductGap,
  productCompareSummaryForNewProductRoutineConflict,
  productCompareSummaryForOutcome,
  productCompareSummaryForShelfRoutineConflict,
} from './product-compare-summaries';
import { productCompareWinnerDecision } from './product-compare-winner-decision';
import { ProductCheckVerdict } from './product-check.types';

const DUPLICATE_OVERLAP_RATIO = 0.75;
const CLEAR_WIN_SCORE_GAP = 18;
const HIGH_CONFIDENCE_SCORE_GAP = 28;

export function buildProductCompareDecision(input: {
  goal: ProductCompareGoal;
  items: EvaluatedCompareItem[];
  overlaps: ProductComparePairwiseOverlap[];
  conflicts: ProductComparePairwiseConflict[];
  language: AppLanguage;
}): ProductCompareDecision {
  const generatedAt = new Date().toISOString();
  const notEnoughDataItem = input.items.find(hasInsufficientData);
  if (notEnoughDataItem) {
    return {
      outcome: ProductCompareOutcome.NotEnoughData,
      winnerItemId: null,
      confidence: AnalysisConfidence.Low,
      summary: productCompareSummaryForOutcome(
        input.goal,
        ProductCompareOutcome.NotEnoughData,
        null,
        input.language,
      ),
      reasons: [
        productCompareReason(ProductCompareReasonCode.NotEnoughData, [
          notEnoughDataItem.itemId,
        ]),
      ],
      generatedAt,
    };
  }

  const duplicateOverlap = findDuplicateOverlap(input.goal, input.overlaps);
  const sorted = [...input.items].sort(
    (left, right) => right.score - left.score,
  );
  const [best, secondBest] = sorted;
  const scoreGap = best && secondBest ? best.score - secondBest.score : 0;
  const directConflict = mostSevereProductCompareConflict(
    input.goal === ProductCompareGoal.NewProductDecision
      ? input.conflicts.filter(involvesAnchor)
      : input.conflicts,
  );

  if (input.goal === ProductCompareGoal.NewProductDecision) {
    return buildNewProductDecision({
      items: input.items,
      duplicateOverlap,
      directConflict,
      best,
      secondBest,
      scoreGap,
      generatedAt,
      language: input.language,
    });
  }

  return buildShelfRoutineDecision({
    items: input.items,
    duplicateOverlap,
    directConflict,
    best,
    secondBest,
    scoreGap,
    generatedAt,
    language: input.language,
  });
}

function buildNewProductDecision(input: {
  items: EvaluatedCompareItem[];
  duplicateOverlap: ProductComparePairwiseOverlap | undefined;
  directConflict: ProductComparePairwiseConflict | undefined;
  best: EvaluatedCompareItem | undefined;
  secondBest: EvaluatedCompareItem | undefined;
  scoreGap: number;
  generatedAt: string;
  language: AppLanguage;
}): ProductCompareDecision {
  const anchor = input.items.find((item) => item.itemId === 'anchor');
  const sameCategoryCandidate = input.items.some(
    (item) =>
      item.itemId !== 'anchor' &&
      anchor !== undefined &&
      item.result.category === anchor.result.category,
  );
  const duplicateCanStillWin =
    input.duplicateOverlap &&
    input.best?.itemId === 'anchor' &&
    input.scoreGap >= HIGH_CONFIDENCE_SCORE_GAP;

  if (input.duplicateOverlap && !duplicateCanStillWin) {
    return duplicateDecision(
      ProductCompareGoal.NewProductDecision,
      input.duplicateOverlap,
      input.language,
      input.generatedAt,
    );
  }

  if (input.directConflict && !sameCategoryCandidate) {
    return {
      outcome: ProductCompareOutcome.NoClearWinner,
      winnerItemId: null,
      confidence: AnalysisConfidence.Medium,
      summary: productCompareSummaryForNewProductRoutineConflict(
        input.language,
      ),
      reasons: conflictRoleReasons(input.directConflict),
      generatedAt: input.generatedAt,
    };
  }

  if (!sameCategoryCandidate && !input.duplicateOverlap) {
    if (anchor && isAnchorWorthAdding(anchor)) {
      return {
        outcome: ProductCompareOutcome.ChooseAnchor,
        winnerItemId: 'anchor',
        confidence: anchor.result.confidence,
        summary: productCompareSummaryForNewProductGap(input.language),
        reasons: [
          productCompareReason(ProductCompareReasonCode.FillsRoutineGap, [
            'anchor',
          ]),
          productCompareReason(
            ProductCompareReasonCode.DifferentRoutineRoles,
            [],
          ),
        ],
        generatedAt: input.generatedAt,
      };
    }

    return noClearWinnerDecision(
      ProductCompareGoal.NewProductDecision,
      input.language,
      input.generatedAt,
    );
  }

  if (
    !input.best ||
    !input.secondBest ||
    input.scoreGap < CLEAR_WIN_SCORE_GAP
  ) {
    return noClearWinnerDecision(
      ProductCompareGoal.NewProductDecision,
      input.language,
      input.generatedAt,
    );
  }

  return productCompareWinnerDecision({
    goal: ProductCompareGoal.NewProductDecision,
    best: input.best,
    secondBest: input.secondBest,
    scoreGap: input.scoreGap,
    duplicateOverlap: input.duplicateOverlap,
    directConflict: input.directConflict,
    generatedAt: input.generatedAt,
    language: input.language,
  });
}

function buildShelfRoutineDecision(input: {
  items: EvaluatedCompareItem[];
  duplicateOverlap: ProductComparePairwiseOverlap | undefined;
  directConflict: ProductComparePairwiseConflict | undefined;
  best: EvaluatedCompareItem | undefined;
  secondBest: EvaluatedCompareItem | undefined;
  scoreGap: number;
  generatedAt: string;
  language: AppLanguage;
}): ProductCompareDecision {
  if (input.duplicateOverlap && input.scoreGap < HIGH_CONFIDENCE_SCORE_GAP) {
    return duplicateDecision(
      ProductCompareGoal.ShelfRoutineDecision,
      input.duplicateOverlap,
      input.language,
      input.generatedAt,
    );
  }

  if (hasDifferentCategories(input.items)) {
    return {
      outcome: ProductCompareOutcome.NoClearWinner,
      winnerItemId: null,
      confidence: AnalysisConfidence.Medium,
      summary: input.directConflict
        ? productCompareSummaryForShelfRoutineConflict(input.language)
        : productCompareSummaryForDifferentShelfRoles(input.language),
      reasons: input.directConflict
        ? conflictRoleReasons(input.directConflict)
        : [
            productCompareReason(
              ProductCompareReasonCode.DifferentRoutineRoles,
              [],
            ),
          ],
      generatedAt: input.generatedAt,
    };
  }

  if (
    !input.best ||
    !input.secondBest ||
    input.scoreGap < CLEAR_WIN_SCORE_GAP
  ) {
    return noClearWinnerDecision(
      ProductCompareGoal.ShelfRoutineDecision,
      input.language,
      input.generatedAt,
    );
  }

  return productCompareWinnerDecision({
    goal: ProductCompareGoal.ShelfRoutineDecision,
    best: input.best,
    secondBest: input.secondBest,
    scoreGap: input.scoreGap,
    duplicateOverlap: input.duplicateOverlap,
    directConflict: input.directConflict,
    generatedAt: input.generatedAt,
    language: input.language,
  });
}

function duplicateDecision(
  goal: ProductCompareGoal,
  duplicateOverlap: ProductComparePairwiseOverlap,
  language: AppLanguage,
  generatedAt: string,
): ProductCompareDecision {
  return {
    outcome: ProductCompareOutcome.NoClearWinner,
    winnerItemId: null,
    confidence: AnalysisConfidence.Medium,
    summary: productCompareSummaryForDuplicate(goal, language),
    reasons: [
      productCompareReason(
        ProductCompareReasonCode.AlreadyOwned,
        [duplicateOverlap.leftItemId, duplicateOverlap.rightItemId],
        duplicateOverlap.ingredientNames,
      ),
      productCompareReason(
        ProductCompareReasonCode.ReplacementOnly,
        [duplicateOverlap.leftItemId, duplicateOverlap.rightItemId],
        duplicateOverlap.ingredientNames,
      ),
    ],
    generatedAt,
  };
}

function noClearWinnerDecision(
  goal: ProductCompareGoal,
  language: AppLanguage,
  generatedAt: string,
): ProductCompareDecision {
  return {
    outcome: ProductCompareOutcome.NoClearWinner,
    winnerItemId: null,
    confidence: AnalysisConfidence.Medium,
    summary: productCompareSummaryForOutcome(
      goal,
      ProductCompareOutcome.NoClearWinner,
      null,
      language,
    ),
    reasons: [
      productCompareReason(ProductCompareReasonCode.SimilarTradeoffs, []),
    ],
    generatedAt,
  };
}

function conflictRoleReasons(
  conflict: ProductComparePairwiseConflict,
): ProductCompareReason[] {
  return [
    productCompareReason(ProductCompareReasonCode.DifferentRoutineRoles, []),
    productCompareReason(
      ProductCompareReasonCode.RoutineConflict,
      [conflict.leftItemId, conflict.rightItemId],
      conflict.ingredientNames,
      conflict.severity,
    ),
    productCompareReason(
      ProductCompareReasonCode.UseTogetherCarefully,
      [conflict.leftItemId, conflict.rightItemId],
      conflict.ingredientNames,
      conflict.severity,
    ),
  ];
}

function hasDifferentCategories(items: EvaluatedCompareItem[]): boolean {
  return new Set(items.map((item) => item.result.category)).size > 1;
}

function findDuplicateOverlap(
  goal: ProductCompareGoal,
  overlaps: ProductComparePairwiseOverlap[],
): ProductComparePairwiseOverlap | undefined {
  return overlaps.find(
    (overlap) =>
      overlap.ratio >= DUPLICATE_OVERLAP_RATIO &&
      (goal === ProductCompareGoal.ShelfRoutineDecision ||
        involvesAnchor(overlap)),
  );
}

function involvesAnchor(input: {
  leftItemId: string;
  rightItemId: string;
}): boolean {
  return input.leftItemId === 'anchor' || input.rightItemId === 'anchor';
}

function isAnchorWorthAdding(anchor: EvaluatedCompareItem): boolean {
  return (
    anchor.result.verdict.label === ProductCheckVerdict.GoodFit ||
    (anchor.result.verdict.label === ProductCheckVerdict.GoodWithLimits &&
      (anchor.result.safetyScore ?? 0) >= 75)
  );
}

function hasInsufficientData(item: EvaluatedCompareItem): boolean {
  return (
    item.result.verdict.label === ProductCheckVerdict.NotEnoughData ||
    item.result.matchedIngredientCount === 0 ||
    item.result.confidence === AnalysisConfidence.Low
  );
}
