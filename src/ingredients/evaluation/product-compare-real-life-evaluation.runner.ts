import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ShelfStatus } from '../../shelf/shelf.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import type { ProductForAnalysis } from '../ingredients.types';
import { OpenAiProductCompareReviewProvider } from '../openai-product-compare-review.provider';
import { ProductCompareService } from '../product-compare.service';
import type { ProductCompareResponse } from '../product-compare.types';
import type { SkinProfileAnalysisContextService } from '../skin-profile-analysis-context.service';
import { productCompareAssertions } from './product-compare-evaluation-assertions';
import {
  PRODUCT_COMPARE_REAL_LIFE_CASES,
  type ProductCompareCaseItem,
  type ProductCompareRealLifeCase,
} from './product-compare-real-life-cases';
import {
  buildProductCheckService,
  createEvaluationRuntime,
  type ProductCheckEvaluationRuntime,
} from './product-check-evaluation-runtime';
import type {
  EvaluationCaseStatus,
  EvaluationCheck,
} from './product-check-evaluation.types';

export type ProductCompareEvaluationCaseResult = {
  kind: 'product_compare';
  id: string;
  title: string;
  status: EvaluationCaseStatus;
  checks: EvaluationCheck[];
  output: ProductCompareResponse;
};

export type ProductCompareRealLifeEvaluationReport = {
  reportType: 'product_compare_real_life_evaluation';
  databaseMode: 'in_memory_mocks_no_typeorm_connection';
  generatedAt: string;
  model: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  cases: ProductCompareEvaluationCaseResult[];
};

type FindOneInput = {
  where?: {
    id?: string;
    user_id?: string;
  };
};

export async function evaluateProductCompareRealLifeCases(
  input: {
    configService?: ConfigService;
    cases?: readonly ProductCompareRealLifeCase[];
    generatedAt?: Date;
  } = {},
): Promise<ProductCompareRealLifeEvaluationReport> {
  const configService = input.configService ?? new ConfigService();
  const runtime = createEvaluationRuntime(configService);
  const cases: ProductCompareEvaluationCaseResult[] = [];

  for (const evaluationCase of input.cases ?? PRODUCT_COMPARE_REAL_LIFE_CASES) {
    cases.push(
      await evaluateProductCompareCase(runtime, configService, evaluationCase),
    );
  }

  const passedCases = cases.filter(
    (result) => result.status === 'passed',
  ).length;

  return sanitizeForReport({
    reportType: 'product_compare_real_life_evaluation',
    databaseMode: 'in_memory_mocks_no_typeorm_connection',
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    model: readEvaluationModel(configService),
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    cases,
  });
}

async function evaluateProductCompareCase(
  runtime: ProductCheckEvaluationRuntime,
  configService: ConfigService,
  evaluationCase: ProductCompareRealLifeCase,
): Promise<ProductCompareEvaluationCaseResult> {
  const service = buildProductCompareService(
    runtime,
    configService,
    evaluationCase,
  );
  const output = await service.compareForUser(
    'product-compare-eval-user',
    {
      goal: evaluationCase.goal,
      anchor: toDtoItem(evaluationCase.anchor),
      candidates: evaluationCase.candidates.map(toDtoItem),
    },
    'en',
  );
  const checks = productCompareAssertions(
    evaluationCase.goal,
    evaluationCase.expected,
    output,
  );

  return {
    kind: 'product_compare',
    id: evaluationCase.id,
    title: evaluationCase.title,
    status: checks.every((item) => item.passed) ? 'passed' : 'failed',
    checks,
    output,
  };
}

function buildProductCompareService(
  runtime: ProductCheckEvaluationRuntime,
  configService: ConfigService,
  evaluationCase: ProductCompareRealLifeCase,
): ProductCompareService {
  const productCheckService = buildProductCheckService(runtime, evaluationCase);
  const skinProfile = buildSkinProfile(evaluationCase);
  const inventoryProducts = (evaluationCase.shelfProducts ?? []).map(
    toInventoryProduct,
  );

  return new ProductCompareService(
    productCheckService,
    runtime.analysisService,
    {
      loadForUser: () => Promise.resolve(skinProfile),
    } as unknown as SkinProfileAnalysisContextService,
    {
      findOne: ({ where }: FindOneInput) =>
        Promise.resolve(
          inventoryProducts.find(
            (product) =>
              product.id === where?.id && product.user_id === where?.user_id,
          ) ?? null,
        ),
    } as unknown as Repository<InventoryProduct>,
    new OpenAiProductCompareReviewProvider(configService),
  );
}

function toDtoItem(item: ProductCompareCaseItem) {
  return item;
}

function buildSkinProfile(
  evaluationCase: ProductCompareRealLifeCase,
): SkinProfile | null {
  if (!evaluationCase.skinProfile) return null;
  return Object.assign(new SkinProfile(), {
    skin_type: evaluationCase.skinProfile.skinType ?? null,
    sensitivity_level: evaluationCase.skinProfile.sensitivityLevel ?? null,
    reaction_history: {
      entries: (evaluationCase.skinProfile.reactionTriggers ?? []).map(
        (trigger) => ({ trigger }),
      ),
    },
  });
}

function toInventoryProduct(product: ProductForAnalysis): InventoryProduct {
  return {
    id: product.id,
    user_id: 'product-compare-eval-user',
    brand: product.brand,
    name: product.name,
    category: product.category,
    status: ShelfStatus.Active,
    identity: {
      brand: product.brand,
      name: product.name,
      category: product.category,
      inciIngredients: product.inciIngredients,
    },
  } as InventoryProduct;
}

function readEvaluationModel(configService: ConfigService): string {
  return (
    configService.get<string>('PRODUCT_CHECK_AI_MODEL')?.trim() ||
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
