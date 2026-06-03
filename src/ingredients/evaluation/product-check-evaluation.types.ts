import type { ExtractionResult } from '../../catalogue/openai-extraction.utils';
import type { AppLanguage } from '../../common/i18n/i18n';
import type { AnalysisResult } from '../ingredients.types';
import type { ProductCheckResponse } from '../product-check.types';

export type EvaluationCaseStatus = 'passed' | 'failed';

export type EvaluationCheck = {
  id: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

export type ProductCheckEvaluationCaseResult = {
  kind: 'product_check';
  id: string;
  title: string;
  language: AppLanguage;
  status: EvaluationCaseStatus;
  checks: EvaluationCheck[];
  output: ProductCheckResponse;
};

export type IngredientAnalysisEvaluationCaseResult = {
  kind: 'ingredient_analysis';
  id: string;
  title: string;
  status: EvaluationCaseStatus;
  checks: EvaluationCheck[];
  output: AnalysisResult;
};

export type PhotoQuickCheckEvaluationCaseResult = {
  kind: 'photo_quick_check';
  id: string;
  title: string;
  language: AppLanguage;
  status: EvaluationCaseStatus;
  checks: EvaluationCheck[];
  extraction: ExtractionResult | null;
  output: ProductCheckResponse | null;
};

export type ProductCheckRealLifeEvaluationCaseResult =
  | ProductCheckEvaluationCaseResult
  | IngredientAnalysisEvaluationCaseResult
  | PhotoQuickCheckEvaluationCaseResult;

export type ProductCheckRealLifeEvaluationReport = {
  reportType: 'product_check_real_life_evaluation';
  generatedAt: string;
  model: string;
  quickCheckLanguages: AppLanguage[];
  runtime: {
    aiReviewMaxOutputTokens: number;
    aiReviewStructuredOutputAttempts: number;
    aiReviewTimeoutMs: number;
    reasoningEffort: string;
  };
  totalCases: number;
  passedCases: number;
  failedCases: number;
  cases: ProductCheckRealLifeEvaluationCaseResult[];
};
