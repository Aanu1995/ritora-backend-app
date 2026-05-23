import {
  buildIngredientProductAnalysisEvaluationGate,
  isSafeIngredientAnalysisEvaluationQueueUrl,
} from './ingredient-product-analysis-evaluation.runner';
import { ingredientAnalysisAssertions } from './product-check-evaluation-assertions';
import {
  AnalysisConfidence,
  AnalysisMode,
  AnalysisStatus,
  IngredientCategory,
} from '../ingredients.types';
import { INGREDIENT_ANALYSIS_REAL_LIFE_CASES } from './product-check-real-life-cases';

describe('ingredient product analysis launch evaluation helpers', () => {
  it('allows clearly non-production SQS queue names for live evaluation', () => {
    expect(
      isSafeIngredientAnalysisEvaluationQueueUrl(
        'https://sqs.eu-north-1.amazonaws.com/123/ritora-dev-ingredient-analysis',
      ),
    ).toBe(true);
    expect(
      isSafeIngredientAnalysisEvaluationQueueUrl(
        'https://sqs.eu-north-1.amazonaws.com/123/ingredient-analysis-eval',
      ),
    ).toBe(true);
  });

  it('blocks ambiguous production-like queue names by default', () => {
    expect(
      isSafeIngredientAnalysisEvaluationQueueUrl(
        'https://sqs.eu-north-1.amazonaws.com/123/ritora-prod-ingredient-analysis',
      ),
    ).toBe(false);
    expect(
      isSafeIngredientAnalysisEvaluationQueueUrl(
        'https://sqs.eu-north-1.amazonaws.com/123/ingredient-analysis',
      ),
    ).toBe(false);
  });

  it('fails the gate when a case fails or SQS was not exercised', () => {
    expect(
      buildIngredientProductAnalysisEvaluationGate({
        failedCases: 0,
        sqsExercised: true,
        cleanupCompleted: true,
      }).passed,
    ).toBe(true);
    expect(
      buildIngredientProductAnalysisEvaluationGate({
        failedCases: 1,
        sqsExercised: true,
        cleanupCompleted: true,
      }).passed,
    ).toBe(false);
    expect(
      buildIngredientProductAnalysisEvaluationGate({
        failedCases: 0,
        sqsExercised: false,
        cleanupCompleted: true,
      }).blockers,
    ).toContain('Live SQS worker path was not exercised.');
  });

  it('treats precise INCI derivative names as passing family-name expectations', () => {
    const evaluationCase = INGREDIENT_ANALYSIS_REAL_LIFE_CASES.find(
      (item) => item.id === 'barrier_moisturizer_ingredient_meanings',
    );
    if (!evaluationCase) throw new Error('Missing barrier evaluation case.');

    const activeNameCheck = ingredientAnalysisAssertions(evaluationCase, {
      mode: AnalysisMode.Focus,
      status: AnalysisStatus.Ok,
      confidence: AnalysisConfidence.High,
      safetyScore: null,
      actives: [
        active('Glycerin'),
        active('Ceramide NP'),
        active('Sodium Hyaluronate'),
      ],
      conflicts: [],
      overlaps: [],
      layeringOrder: [],
      productsMissingInci: [],
      engineVersion: 'evaluation',
      generatedAt: '2026-05-23T00:00:00.000Z',
    }).find((check) => check.id === 'active_names');

    expect(activeNameCheck?.passed).toBe(true);
  });
});

function active(displayName: string) {
  return {
    slug: displayName.toLowerCase().replace(/\s+/g, '-'),
    displayName,
    category: IngredientCategory.Humectant,
    summary: '',
    avoidCategories: [],
    avoidIngredients: [],
    mitigationHint: null,
  };
}
