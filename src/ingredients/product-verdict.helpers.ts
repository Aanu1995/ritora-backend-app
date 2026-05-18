import { AnalysisSeverity, type AnalysisConflict } from './ingredients.types';
import {
  ProductCheckReasonCode,
  type ProductCheckReason,
} from './product-check.types';

const CHECKED_PRODUCT_ID = 'checked-product';

export function isCheckedProductInternalConflict(
  conflict: AnalysisConflict,
): boolean {
  return (
    conflict.productAId === CHECKED_PRODUCT_ID &&
    conflict.productBId === CHECKED_PRODUCT_ID
  );
}

export function isCheckedProductRoutineConflict(
  conflict: AnalysisConflict,
): boolean {
  const involvesCheckedProduct =
    conflict.productAId === CHECKED_PRODUCT_ID ||
    conflict.productBId === CHECKED_PRODUCT_ID;

  return involvesCheckedProduct && !isCheckedProductInternalConflict(conflict);
}

export function toConflictReasonCode(
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

export function uniqueIngredientNames(names: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const name of names) {
    if (seen.has(name)) {
      continue;
    }

    seen.add(name);
    unique.push(name);
  }

  return unique;
}

export function reasonPriority(reason: ProductCheckReason): number {
  switch (reason.code) {
    case ProductCheckReasonCode.InsufficientIngredients:
      return 0;
    case ProductCheckReasonCode.HighConflict:
      return 10;
    case ProductCheckReasonCode.ReactionTrigger:
      return 12;
    case ProductCheckReasonCode.ProductReactionSignal:
      return 14;
    case ProductCheckReasonCode.RecentJournalReaction:
      return 16;
    case ProductCheckReasonCode.SuggestionHistoryReaction:
      return 18;
    case ProductCheckReasonCode.SensitiveProfile:
      return 20;
    case ProductCheckReasonCode.LowConfidence:
      return 22;
    case ProductCheckReasonCode.ReviewRequired:
      return 24;
    case ProductCheckReasonCode.PhotosensitizingActive:
      return 26;
    case ProductCheckReasonCode.MediumConflict:
      return 30;
    case ProductCheckReasonCode.DuplicateExposure:
      return 32;
    case ProductCheckReasonCode.MissingPersonalContext:
      return 34;
    case ProductCheckReasonCode.MissingReactionContext:
      return 36;
    case ProductCheckReasonCode.LowConflict:
      return 40;
  }
}
