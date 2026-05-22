import { ConfigService } from '@nestjs/config';
import {
  ingredientAnalysisAssertions,
  productCheckAssertions,
} from './product-check-evaluation-assertions';
import {
  buildProductCheckService,
  createEvaluationRuntime,
  type ProductCheckEvaluationRuntime,
} from './product-check-evaluation-runtime';
import {
  type IngredientAnalysisEvaluationCaseResult,
  type ProductCheckEvaluationCaseResult,
  type ProductCheckRealLifeEvaluationCaseResult,
  type ProductCheckRealLifeEvaluationReport,
} from './product-check-evaluation.types';
import { evaluatePhotoQuickCheckCase } from './product-check-photo-evaluation';
import {
  INGREDIENT_ANALYSIS_REAL_LIFE_CASES,
  PHOTO_QUICK_CHECK_REAL_LIFE_CASES,
  PRODUCT_CHECK_REAL_LIFE_CASES,
  type IngredientAnalysisRealLifeCase,
  type PhotoQuickCheckRealLifeCase,
  type ProductCheckRealLifeCase,
} from './product-check-real-life-cases';

export type { ProductCheckRealLifeEvaluationReport } from './product-check-evaluation.types';

export async function evaluateProductCheckRealLifeCases(
  input: {
    configService?: ConfigService;
    productCases?: readonly ProductCheckRealLifeCase[];
    photoCases?: readonly PhotoQuickCheckRealLifeCase[];
    ingredientCases?: readonly IngredientAnalysisRealLifeCase[];
    generatedAt?: Date;
  } = {},
): Promise<ProductCheckRealLifeEvaluationReport> {
  const configService = input.configService ?? new ConfigService();
  const runtime = createEvaluationRuntime(configService);
  const cases: ProductCheckRealLifeEvaluationCaseResult[] = [];

  for (const evaluationCase of input.productCases ??
    PRODUCT_CHECK_REAL_LIFE_CASES) {
    cases.push(await evaluateProductCase(runtime, evaluationCase));
  }

  for (const evaluationCase of input.photoCases ??
    PHOTO_QUICK_CHECK_REAL_LIFE_CASES) {
    cases.push(await evaluatePhotoQuickCheckCase(runtime, evaluationCase));
  }

  for (const evaluationCase of input.ingredientCases ??
    INGREDIENT_ANALYSIS_REAL_LIFE_CASES) {
    cases.push(await evaluateIngredientCase(runtime, evaluationCase));
  }

  const passedCases = cases.filter(
    (result) => result.status === 'passed',
  ).length;

  return sanitizeForReport({
    reportType: 'product_check_real_life_evaluation',
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    model: readEvaluationModel(configService),
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    cases,
  });
}

async function evaluateProductCase(
  runtime: ProductCheckEvaluationRuntime,
  evaluationCase: ProductCheckRealLifeCase,
): Promise<ProductCheckEvaluationCaseResult> {
  const response = await buildProductCheckService(
    runtime,
    evaluationCase,
  ).checkForUser('eval-user', { product: evaluationCase.product }, 'en');
  const checks = productCheckAssertions(evaluationCase.expected, response);

  return {
    kind: 'product_check',
    id: evaluationCase.id,
    title: evaluationCase.title,
    status: checks.every((item) => item.passed) ? 'passed' : 'failed',
    checks,
    output: response,
  };
}

async function evaluateIngredientCase(
  runtime: ProductCheckEvaluationRuntime,
  evaluationCase: IngredientAnalysisRealLifeCase,
): Promise<IngredientAnalysisEvaluationCaseResult> {
  const output = await runtime.analysisService.analyze({
    products: evaluationCase.products,
    skinProfile: null,
    language: 'en',
    withExplanations: true,
    focusProductId: evaluationCase.focusProductId,
  });
  const checks = ingredientAnalysisAssertions(evaluationCase, output);

  return {
    kind: 'ingredient_analysis',
    id: evaluationCase.id,
    title: evaluationCase.title,
    status: checks.every((item) => item.passed) ? 'passed' : 'failed',
    checks,
    output,
  };
}

function readEvaluationModel(configService: ConfigService): string {
  return (
    configService.get<string>('PRODUCT_CHECK_AI_MODEL')?.trim() ||
    configService.get<string>('INGREDIENT_EXPLANATION_AI_MODEL')?.trim() ||
    configService.get<string>('CATALOGUE_AI_MODEL')?.trim() ||
    configService.get<string>('OPENAI_MODEL')?.trim() ||
    'unknown'
  );
}

function sanitizeForReport<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted-openai-key]')
      .replace(/\bAKIA[0-9A-Z]{12,}\b/g, '[redacted-aws-access-key]') as T;
  }
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((item) =>
      sanitizeForReport(item),
    ) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeForReport(entry),
      ]),
    ) as T;
  }
  return value;
}
