import type { ExtractionResult } from '../../catalogue/openai-extraction.utils';
import type { AnalysisResult } from '../ingredients.types';
import {
  ProductCheckAiReviewStatus,
  type ProductCheckResponse,
} from '../product-check.types';
import type {
  IngredientAnalysisRealLifeCase,
  PhotoQuickCheckRealLifeCase,
  ProductCheckExpected,
} from './product-check-real-life-cases';
import type { EvaluationCheck } from './product-check-evaluation.types';

export function productCheckAssertions(
  expected: ProductCheckExpected,
  response: ProductCheckResponse,
): EvaluationCheck[] {
  const checks = [
    check('verdict_label', expected.verdicts, response.verdict.label, (value) =>
      expected.verdicts.includes(value),
    ),
    check(
      'forbidden_verdicts',
      expected.forbiddenVerdicts ?? [],
      response.verdict.label,
      (value) => !(expected.forbiddenVerdicts ?? []).includes(value),
    ),
    checkOptional(
      'next_action',
      expected.nextActions,
      response.verdict.nextAction,
    ),
    checkOptional(
      'context_level',
      expected.contextLevel,
      response.context.level,
    ),
    checkOptional(
      'confidence',
      expected.confidence,
      response.verdict.confidence,
    ),
    checkOptional(
      'safety_score',
      expected.safetyScore,
      response.verdict.safetyScore,
    ),
    checkOptional(
      'min_safety_score',
      expected.minSafetyScore,
      response.verdict.safetyScore,
    ),
    checkOptional(
      'max_safety_score',
      expected.maxSafetyScore,
      response.verdict.safetyScore,
    ),
    checkOptional(
      'max_reason_count',
      expected.maxReasonCount,
      response.verdict.reasons.length,
    ),
    checkOptional(
      'should_consider_alternatives',
      expected.shouldConsiderAlternatives,
      response.purchaseGuidance.shouldConsiderAlternatives,
    ),
    checkIncludes(
      'purchase_guidance_reason_codes',
      expected.purchaseGuidanceReasonCodes,
      response.purchaseGuidance.reasonCodes,
    ),
    checkIncludes(
      'context_signals',
      expected.contextSignals,
      response.context.usedSignals,
    ),
    checkIncludes(
      'reason_codes',
      expected.reasonCodes,
      response.verdict.reasons.map((reason) => reason.code),
    ),
    checkExcludes(
      'forbidden_reason_codes',
      expected.forbiddenReasonCodes,
      response.verdict.reasons.map((reason) => reason.code),
    ),
    checkIncludes(
      'active_names',
      expected.activeNames,
      response.analysis.actives.map((active) => active.displayName),
    ),
  ];

  if (expected.requireAiReviewed) {
    checks.push(
      check(
        'ai_reviewed',
        ProductCheckAiReviewStatus.Reviewed,
        response.aiReview.status,
        (value) => value === ProductCheckAiReviewStatus.Reviewed,
      ),
    );
  }
  if (expected.requireAiSummary) {
    checks.push(
      check('ai_summary', true, response.aiReview.summary, (value) =>
        Boolean(value?.trim()),
      ),
    );
  }
  if (expected.requireNoDuplicateReasonKeys) {
    checks.push(noDuplicateReasonKeysCheck(response));
  }

  return checks;
}

export function ingredientAnalysisAssertions(
  evaluationCase: IngredientAnalysisRealLifeCase,
  output: AnalysisResult,
): EvaluationCheck[] {
  const expected = evaluationCase.expected;
  return [
    checkOptional('confidence', expected.confidence, output.confidence),
    checkOptional(
      'min_safety_score',
      expected.minSafetyScore,
      output.safetyScore,
    ),
    checkOptional(
      'max_safety_score',
      expected.maxSafetyScore,
      output.safetyScore,
    ),
    checkIncludes(
      'active_names',
      expected.activeNames,
      output.actives.map((active) => active.displayName),
    ),
    checkIncludes(
      'conflict_codes',
      expected.conflictCodes,
      output.conflicts.map((conflict) => conflict.code),
    ),
    checkIncludes(
      'conflict_severities',
      expected.conflictSeverities,
      output.conflicts.map((conflict) => conflict.severity),
    ),
    check(
      'ai_explanations',
      expected.requireExplanations ?? false,
      output.conflicts.some((conflict) => Boolean(conflict.explanation)),
      (value) => !expected.requireExplanations || value,
    ),
  ];
}

export function photoExtractionAssertions(
  evaluationCase: PhotoQuickCheckRealLifeCase,
  extraction: ExtractionResult | null,
): EvaluationCheck[] {
  const expected = evaluationCase.expectedExtraction;
  const identity = extraction?.data.identity;
  const ingredients = identity?.inciIngredients ?? [];

  return [
    check('photo_extraction_returned', true, extraction, Boolean),
    checkOptionalStringIncludes(
      'photo_brand',
      expected.brandIncludes,
      identity?.brand ?? null,
    ),
    checkOptionalStringIncludes(
      'photo_name',
      expected.nameIncludes,
      identity?.name ?? null,
    ),
    checkOptional(
      'photo_category',
      expected.category,
      identity?.category ?? null,
    ),
    checkOptional(
      'photo_min_ingredient_count',
      expected.minIngredientCount,
      ingredients.length,
    ),
    checkIncludes(
      'photo_ingredient_names',
      expected.ingredientNames,
      ingredients,
    ),
  ];
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
  expected: T | T[] | undefined,
  actual: T | null,
): EvaluationCheck {
  return check(id, expected ?? 'not asserted', actual, (value) => {
    if (expected === undefined) return true;
    if (Array.isArray(expected)) return expected.includes(value as T);
    if (typeof expected === 'number' && typeof value === 'number') {
      return id.includes('min_') ? value >= expected : value <= expected;
    }
    return value === expected;
  });
}

function checkOptionalStringIncludes(
  id: string,
  expected: string | undefined,
  actual: string | null,
): EvaluationCheck {
  return check(id, expected ?? 'not asserted', actual, (value) => {
    if (expected === undefined) return true;
    return value?.toLowerCase().includes(expected.toLowerCase()) ?? false;
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

function noDuplicateReasonKeysCheck(
  response: ProductCheckResponse,
): EvaluationCheck {
  const keys = response.verdict.reasons.map((reason) =>
    [
      reason.code,
      reason.conflictCode ?? '',
      reason.ingredientNames.join(','),
    ].join(':'),
  );
  return check('no_duplicate_reason_keys', true, keys, (values) => {
    return new Set(values).size === values.length;
  });
}
