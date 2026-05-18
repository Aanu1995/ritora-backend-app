import {
  ProductCompareAiReviewStatus,
  ProductCompareGoal,
  type ProductCompareResponse,
} from '../product-compare.types';
import type { EvaluationCheck } from './product-check-evaluation.types';
import type { ProductCompareExpected } from './product-compare-real-life-cases';

const BUYING_LANGUAGE_PATTERN =
  /\b(buy|buying|purchase|purchasing|cart|checkout|shop|shopping)\b|worth buying|add to shelf|add it/i;
const TECHNICAL_ITEM_ID_PATTERN = /\b(?:anchor|candidate-\d+)\b/i;

export function productCompareAssertions(
  goal: ProductCompareGoal,
  expected: ProductCompareExpected,
  response: ProductCompareResponse,
): EvaluationCheck[] {
  const reasonCodes = response.comparison.reasons.map((reason) => reason.code);
  const checks = [
    check('goal', goal, response.goal, (value) => value === goal),
    check('outcome', expected.outcomes, response.comparison.outcome, (value) =>
      expected.outcomes.includes(value),
    ),
    checkOptional(
      'winner_item_id',
      expected.winnerItemIds,
      response.comparison.winnerItemId,
    ),
    checkOptional(
      'confidence',
      expected.confidence,
      response.comparison.confidence,
    ),
    checkOptional(
      'context_level',
      expected.contextLevel,
      response.context.level,
    ),
    checkIncludes(
      'context_signals',
      expected.contextSignals,
      response.context.usedSignals,
    ),
    checkIncludes('reason_codes', expected.reasonCodes, reasonCodes),
    checkExcludes(
      'forbidden_reason_codes',
      expected.forbiddenReasonCodes,
      reasonCodes,
    ),
    check('summary_present', true, response.comparison.summary, (value) =>
      Boolean(value.trim()),
    ),
    checkStringIncludes(
      'summary_includes',
      expected.requireSummaryIncludes,
      response.comparison.summary,
    ),
    checkStringExcludes(
      'summary_excludes',
      expected.requireSummaryExcludes,
      response.comparison.summary,
    ),
    noTechnicalItemIdsCheck(response),
  ];

  if (expected.requireAiReviewed) {
    checks.push(
      check(
        'ai_reviewed',
        ProductCompareAiReviewStatus.Reviewed,
        response.aiReview.status,
        (value) => value === ProductCompareAiReviewStatus.Reviewed,
      ),
    );
  }

  if (
    expected.requireNoBuyingLanguage ||
    goal === ProductCompareGoal.ShelfRoutineDecision
  ) {
    checks.push(noBuyingLanguageCheck(response));
  }

  if (expected.requireNoDuplicateReasonKeys) {
    checks.push(noDuplicateReasonKeysCheck(response));
  }

  return checks;
}

function check<T>(
  id: string,
  expected: unknown,
  actual: T,
  predicate: (actual: T) => boolean,
): EvaluationCheck {
  return { id, expected, actual, passed: predicate(actual) };
}

function checkOptional<T>(
  id: string,
  expected: readonly T[] | T | undefined,
  actual: T | null,
): EvaluationCheck {
  return check(id, expected ?? 'not asserted', actual, (value) => {
    if (expected === undefined) return true;
    if (Array.isArray(expected)) return expected.includes(value);
    return value === expected;
  });
}

function checkIncludes<T>(
  id: string,
  expected: readonly T[] | undefined,
  actual: readonly T[],
): EvaluationCheck {
  return check(id, expected ?? [], actual, (values) =>
    (expected ?? []).every((item) => values.includes(item)),
  );
}

function checkExcludes<T>(
  id: string,
  expected: readonly T[] | undefined,
  actual: readonly T[],
): EvaluationCheck {
  return check(id, expected ?? [], actual, (values) =>
    (expected ?? []).every((item) => !values.includes(item)),
  );
}

function checkStringIncludes(
  id: string,
  expected: readonly string[] | undefined,
  actual: string,
): EvaluationCheck {
  return check(id, expected ?? [], actual, (value) =>
    (expected ?? []).every((item) =>
      value.toLowerCase().includes(item.toLowerCase()),
    ),
  );
}

function checkStringExcludes(
  id: string,
  expected: readonly string[] | undefined,
  actual: string,
): EvaluationCheck {
  return check(id, expected ?? [], actual, (value) =>
    (expected ?? []).every(
      (item) => !value.toLowerCase().includes(item.toLowerCase()),
    ),
  );
}

function noBuyingLanguageCheck(
  response: ProductCompareResponse,
): EvaluationCheck {
  return check(
    'no_buying_language_for_shelf_goal',
    true,
    response.comparison.summary,
    (value) => !BUYING_LANGUAGE_PATTERN.test(value),
  );
}

function noTechnicalItemIdsCheck(
  response: ProductCompareResponse,
): EvaluationCheck {
  return check(
    'no_technical_item_ids_in_summary',
    true,
    response.comparison.summary,
    (value) => !TECHNICAL_ITEM_ID_PATTERN.test(value),
  );
}

function noDuplicateReasonKeysCheck(
  response: ProductCompareResponse,
): EvaluationCheck {
  const keys = response.comparison.reasons.map((reason) =>
    [
      reason.code,
      [...reason.itemIds].sort().join('|'),
      [...reason.ingredientNames].sort().join('|'),
    ].join(':'),
  );

  return check('no_duplicate_reason_keys', true, keys, (values) => {
    return new Set(values).size === values.length;
  });
}
