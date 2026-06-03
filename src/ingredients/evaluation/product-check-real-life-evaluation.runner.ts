import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  type AppLanguage,
} from '../../common/i18n/i18n';
import { OPENAI_PRODUCT_CHECK_REASONING_EFFORT } from '../../common/utils/openai-request-options';
import {
  ingredientAnalysisAssertions,
  productCheckAssertions,
} from './product-check-evaluation-assertions';
import {
  OPENAI_PRODUCT_CHECK_REVIEW_MAX_OUTPUT_TOKENS,
  OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS,
  OPENAI_PRODUCT_CHECK_REVIEW_STRUCTURED_OUTPUT_ATTEMPTS,
} from '../openai-product-check-review.provider';
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

export const DEFAULT_PRODUCT_CHECK_EVALUATION_LANGUAGES = [
  DEFAULT_LANGUAGE,
] as const satisfies readonly AppLanguage[];

export async function evaluateProductCheckRealLifeCases(
  input: {
    configService?: ConfigService;
    productCases?: readonly ProductCheckRealLifeCase[];
    photoCases?: readonly PhotoQuickCheckRealLifeCase[];
    ingredientCases?: readonly IngredientAnalysisRealLifeCase[];
    languages?: readonly string[];
    generatedAt?: Date;
  } = {},
): Promise<ProductCheckRealLifeEvaluationReport> {
  const configService = input.configService ?? new ConfigService();
  const runtime = createEvaluationRuntime(configService);
  const cases: ProductCheckRealLifeEvaluationCaseResult[] = [];
  const quickCheckLanguages = resolveProductCheckEvaluationLanguages(
    input.languages,
  );
  const includeLanguageInCaseId = quickCheckLanguages.length > 1;

  for (const evaluationCase of input.productCases ??
    PRODUCT_CHECK_REAL_LIFE_CASES) {
    for (const language of quickCheckLanguages) {
      cases.push(
        await evaluateProductCase(
          runtime,
          evaluationCase,
          language,
          includeLanguageInCaseId,
        ),
      );
    }
  }

  for (const evaluationCase of input.photoCases ??
    PHOTO_QUICK_CHECK_REAL_LIFE_CASES) {
    for (const language of quickCheckLanguages) {
      cases.push(
        await evaluatePhotoQuickCheckCase(
          runtime,
          evaluationCase,
          language,
          includeLanguageInCaseId,
        ),
      );
    }
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
    quickCheckLanguages,
    runtime: {
      aiReviewMaxOutputTokens: OPENAI_PRODUCT_CHECK_REVIEW_MAX_OUTPUT_TOKENS,
      aiReviewStructuredOutputAttempts:
        OPENAI_PRODUCT_CHECK_REVIEW_STRUCTURED_OUTPUT_ATTEMPTS,
      aiReviewTimeoutMs: OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS,
      reasoningEffort: OPENAI_PRODUCT_CHECK_REASONING_EFFORT,
    },
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    cases,
  });
}

async function evaluateProductCase(
  runtime: ProductCheckEvaluationRuntime,
  evaluationCase: ProductCheckRealLifeCase,
  language: AppLanguage,
  includeLanguageInCaseId: boolean,
): Promise<ProductCheckEvaluationCaseResult> {
  const response = await buildProductCheckService(
    runtime,
    evaluationCase,
  ).checkForUser('eval-user', { product: evaluationCase.product }, language);
  const checks = productCheckAssertions(evaluationCase.expected, response);

  return {
    kind: 'product_check',
    id: localizedEvaluationId(
      evaluationCase.id,
      language,
      includeLanguageInCaseId,
    ),
    title: localizedEvaluationTitle(
      evaluationCase.title,
      language,
      includeLanguageInCaseId,
    ),
    language,
    status: checks.every((item) => item.passed) ? 'passed' : 'failed',
    checks,
    output: response,
  };
}

export function resolveProductCheckEvaluationLanguages(
  languages?: readonly string[] | null,
): AppLanguage[] {
  if (!languages || languages.length === 0) {
    return [...DEFAULT_PRODUCT_CHECK_EVALUATION_LANGUAGES];
  }

  const resolved: AppLanguage[] = [];
  for (const language of languages) {
    const normalizedLanguage = language.trim().toLowerCase();
    if (!isSupportedEvaluationLanguage(normalizedLanguage)) {
      throw new Error(
        `Unsupported Quick Check evaluation language: ${language}`,
      );
    }
    if (!resolved.includes(normalizedLanguage)) {
      resolved.push(normalizedLanguage);
    }
  }

  return resolved.length > 0
    ? resolved
    : [...DEFAULT_PRODUCT_CHECK_EVALUATION_LANGUAGES];
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

function isSupportedEvaluationLanguage(value: string): value is AppLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function localizedEvaluationId(
  id: string,
  language: AppLanguage,
  includeLanguageInCaseId: boolean,
): string {
  return includeLanguageInCaseId ? `${id}__${language}` : id;
}

function localizedEvaluationTitle(
  title: string,
  language: AppLanguage,
  includeLanguageInCaseId: boolean,
): string {
  return includeLanguageInCaseId ? `${title} [${language}]` : title;
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
