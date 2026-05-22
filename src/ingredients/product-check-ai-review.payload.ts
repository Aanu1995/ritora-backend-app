import { AnalysisConfidence, AnalysisSeverity } from './ingredients.types';
import type { ProductCheckAiReviewInput } from './product-check-ai-review.port';
import {
  PRODUCT_CHECK_REVIEW_CONFIDENCE,
  PRODUCT_CHECK_REVIEW_REASON_CODES,
  PRODUCT_CHECK_REVIEW_VERDICTS,
  type ParsedProductCheckAiReview,
} from './product-check-ai-review.schema';
import {
  ProductCheckAiReviewStatus,
  ProductCheckEvidenceKind,
  ProductCheckPersonalizationLevel,
  ProductCheckReasonCode,
  ProductCheckVerdict,
  type ProductCheckAiReview,
} from './product-check.types';
import { hasReactionContext } from './product-check.utils';

const MAX_INGREDIENT_NAMES = 6;
const MAX_SUMMARY_CHARS = 280;
const VERDICT_RISK_ORDER: Record<ProductCheckVerdict, number> = {
  [ProductCheckVerdict.GoodFit]: 0,
  [ProductCheckVerdict.GoodWithLimits]: 1,
  [ProductCheckVerdict.IngredientsOnly]: 1,
  [ProductCheckVerdict.UseCarefully]: 2,
  [ProductCheckVerdict.AvoidForProfile]: 3,
  [ProductCheckVerdict.NotEnoughData]: 4,
};

export function buildProductCheckAiReviewPayload(
  input: ProductCheckAiReviewInput,
) {
  return {
    language: input.language,
    product: {
      category: input.product.category,
      ingredientCount: input.product.inciIngredients.length,
      inciIngredients: input.product.inciIngredients,
    },
    analysis: {
      status: input.analysis.status,
      confidence: input.analysis.confidence,
      safetyScore: input.analysis.safetyScore,
      actives: input.analysis.actives.map((active) => ({
        name: active.displayName,
        category: active.category,
        avoidCategories: active.avoidCategories,
        avoidIngredients: active.avoidIngredients.map(
          (item) => item.displayName,
        ),
      })),
      conflicts: input.analysis.conflicts.map((conflict) => ({
        severity: conflict.severity,
        code: conflict.code,
        ingredientA: conflict.ingredientA,
        ingredientB: conflict.ingredientB,
        description: conflict.description,
      })),
      overlaps: input.analysis.overlaps.map((overlap) => ({
        severity: overlap.severity,
        ingredient: overlap.ingredient,
        description: overlap.description,
      })),
    },
    context: input.context,
    baselineVerdict: {
      label: input.baselineVerdict.label,
      confidence: input.baselineVerdict.confidence,
      safetyScore: input.baselineVerdict.safetyScore,
      reasonCodes: input.baselineVerdict.reasons.map((reason) => reason.code),
    },
    matching: {
      matchedIngredientNames: input.matchedIngredientNames,
      unresolvedIngredientCount: input.unresolvedIngredientTokens.length,
    },
    reactionEvidence: input.reactionEvidence.map((evidence) => ({
      kind: evidence.kind,
      confidence: evidence.confidence,
      ingredientNames: evidence.ingredientNames,
      reactionSignalCount: evidence.reactionSignalCount,
      usageDaysLast90: evidence.usageDaysLast90,
    })),
  };
}

export function sanitizeProductCheckAiReview(
  parsed: ParsedProductCheckAiReview,
  input: ProductCheckAiReviewInput,
): ProductCheckAiReview {
  const allowedIngredientNames = allowedAiReviewIngredientNames(input);
  const allowedReasonCodes = allowedAiReviewReasonCodes(input);
  const reasonCodes = unique(
    (parsed.reasonCodes ?? []).filter((code): code is ProductCheckReasonCode =>
      PRODUCT_CHECK_REVIEW_REASON_CODES.includes(code),
    ),
  ).filter((code) => allowedReasonCodes.has(code));
  const ingredientNames = unique(
    (parsed.ingredientNames ?? [])
      .map((name) => normalizeName(name))
      .filter((name) => allowedIngredientNames.has(name.toLowerCase())),
  ).slice(0, MAX_INGREDIENT_NAMES);
  const suggestedVerdict = sanitizeSuggestedVerdict(
    parsed.suggestedVerdict,
    input,
    reasonCodes,
  );
  const confidence = sanitizeConfidence(
    parsed.confidence,
    input.baselineVerdict.confidence,
  );
  const summary =
    typeof parsed.summary === 'string'
      ? parsed.summary.trim().slice(0, MAX_SUMMARY_CHARS) || null
      : null;

  return {
    status: ProductCheckAiReviewStatus.Reviewed,
    confidence,
    suggestedVerdict,
    reasonCodes,
    ingredientNames,
    summary,
    reviewedAt: new Date().toISOString(),
  };
}

export function unavailableProductCheckAiReview(): ProductCheckAiReview {
  return {
    status: ProductCheckAiReviewStatus.Unavailable,
    confidence: AnalysisConfidence.Low,
    suggestedVerdict: null,
    reasonCodes: [],
    ingredientNames: [],
    summary: null,
    reviewedAt: new Date().toISOString(),
  };
}

function sanitizeSuggestedVerdict(
  verdict: ProductCheckVerdict | null | undefined,
  input: ProductCheckAiReviewInput,
  reasonCodes: readonly ProductCheckReasonCode[],
): ProductCheckVerdict | null {
  if (!verdict || !PRODUCT_CHECK_REVIEW_VERDICTS.includes(verdict)) {
    return null;
  }

  if (
    verdict === ProductCheckVerdict.NotEnoughData ||
    input.baselineVerdict.label === ProductCheckVerdict.NotEnoughData ||
    input.baselineVerdict.label === ProductCheckVerdict.IngredientsOnly ||
    VERDICT_RISK_ORDER[verdict] <=
      VERDICT_RISK_ORDER[input.baselineVerdict.label]
  ) {
    return null;
  }

  if (
    verdict === ProductCheckVerdict.AvoidForProfile &&
    !hasHighInternalConflict(input)
  ) {
    return null;
  }

  if (
    verdict === ProductCheckVerdict.UseCarefully &&
    !hasUseCarefullySupport(reasonCodes)
  ) {
    return null;
  }

  if (
    verdict === ProductCheckVerdict.GoodWithLimits &&
    !hasGoodWithLimitsSupport(reasonCodes)
  ) {
    return null;
  }

  return verdict;
}

function sanitizeConfidence(
  confidence: AnalysisConfidence | undefined,
  fallback: AnalysisConfidence,
): AnalysisConfidence {
  return confidence && PRODUCT_CHECK_REVIEW_CONFIDENCE.includes(confidence)
    ? confidence
    : fallback;
}

function allowedAiReviewIngredientNames(
  input: ProductCheckAiReviewInput,
): Set<string> {
  return new Set(
    [
      ...input.product.inciIngredients,
      ...input.matchedIngredientNames,
      ...input.analysis.actives.map((active) => active.displayName),
      ...input.analysis.conflicts.flatMap((conflict) => [
        conflict.ingredientA,
        conflict.ingredientB,
      ]),
      ...input.analysis.overlaps.map((overlap) => overlap.ingredient),
      ...input.reactionEvidence.flatMap((evidence) => evidence.ingredientNames),
    ]
      .map((name) => normalizeName(name).toLowerCase())
      .filter(Boolean),
  );
}

function allowedAiReviewReasonCodes(
  input: ProductCheckAiReviewInput,
): Set<ProductCheckReasonCode> {
  const allowed = new Set(
    input.baselineVerdict.reasons.map((reason) => reason.code),
  );

  for (const conflict of input.analysis.conflicts) {
    allowed.add(conflictReasonCode(conflict.severity));
  }

  if (input.analysis.overlaps.length > 0) {
    allowed.add(ProductCheckReasonCode.DuplicateExposure);
  }

  if (input.analysis.confidence === AnalysisConfidence.Low) {
    allowed.add(ProductCheckReasonCode.LowConfidence);
  }

  if (input.context.level === ProductCheckPersonalizationLevel.Educational) {
    allowed.add(ProductCheckReasonCode.MissingPersonalContext);
  } else if (!hasReactionContext(input.context)) {
    allowed.add(ProductCheckReasonCode.MissingReactionContext);
  }

  if (input.context.recentJournalReactionCount > 0) {
    allowed.add(ProductCheckReasonCode.RecentJournalReaction);
  }

  if (input.context.recentSuggestionReactionCount > 0) {
    allowed.add(ProductCheckReasonCode.SuggestionHistoryReaction);
  }

  if (input.reactionEvidence.length > 0) {
    allowed.add(ProductCheckReasonCode.ProductReactionSignal);
  }

  if (
    input.reactionEvidence.some(
      (evidence) =>
        evidence.kind === ProductCheckEvidenceKind.ProfileReactionTrigger,
    )
  ) {
    allowed.add(ProductCheckReasonCode.ReactionTrigger);
  }

  return allowed;
}

function hasHighInternalConflict(input: ProductCheckAiReviewInput): boolean {
  return input.analysis.conflicts.some(
    (conflict) =>
      conflict.severity === AnalysisSeverity.High &&
      conflict.productAId === input.product.id &&
      conflict.productBId === input.product.id,
  );
}

function hasUseCarefullySupport(
  reasonCodes: readonly ProductCheckReasonCode[],
): boolean {
  return reasonCodes.some((code) =>
    [
      ProductCheckReasonCode.HighConflict,
      ProductCheckReasonCode.MediumConflict,
      ProductCheckReasonCode.ProductReactionSignal,
      ProductCheckReasonCode.RecentJournalReaction,
      ProductCheckReasonCode.SuggestionHistoryReaction,
      ProductCheckReasonCode.LowConfidence,
      ProductCheckReasonCode.SensitiveProfile,
      ProductCheckReasonCode.ReactionTrigger,
      ProductCheckReasonCode.PhotosensitizingActive,
    ].includes(code),
  );
}

function hasGoodWithLimitsSupport(
  reasonCodes: readonly ProductCheckReasonCode[],
): boolean {
  return reasonCodes.some((code) =>
    [
      ProductCheckReasonCode.LowConflict,
      ProductCheckReasonCode.DuplicateExposure,
      ProductCheckReasonCode.MissingReactionContext,
      ProductCheckReasonCode.LowConfidence,
      ProductCheckReasonCode.ReviewRequired,
      ProductCheckReasonCode.PhotosensitizingActive,
    ].includes(code),
  );
}

function conflictReasonCode(
  severity: AnalysisSeverity,
): ProductCheckReasonCode {
  if (severity === AnalysisSeverity.High) {
    return ProductCheckReasonCode.HighConflict;
  }

  if (severity === AnalysisSeverity.Medium) {
    return ProductCheckReasonCode.MediumConflict;
  }

  return ProductCheckReasonCode.LowConflict;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
