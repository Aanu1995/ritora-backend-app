import { ConfigService } from '@nestjs/config';
import { ProductCategory } from '../../shelf/shelf.types';
import {
  ProductCompareGoal,
  ProductCompareItemKind,
  ProductCompareOutcome,
  ProductCompareReasonCode,
} from '../product-compare.types';
import { ProductCheckSource } from '../product-check.types';
import {
  evaluateProductCompareRealLifeCases,
  type ProductCompareRealLifeEvaluationReport,
} from './product-compare-real-life-evaluation.runner';
import type { ProductCompareRealLifeCase } from './product-compare-real-life-cases';

describe('evaluateProductCompareRealLifeCases', () => {
  it('resolves shelf candidates through the in-memory repository find mock', async () => {
    const report = await evaluateProductCompareRealLifeCases({
      configService: noOpenAiConfigService(),
      cases: [buildDuplicateShelfCase()],
      generatedAt: new Date('2026-06-03T19:00:00.000Z'),
    });

    expect(report).toMatchObject<ProductCompareRealLifeEvaluationReport>({
      reportType: 'product_compare_real_life_evaluation',
      databaseMode: 'in_memory_mocks_no_typeorm_connection',
      generatedAt: '2026-06-03T19:00:00.000Z',
      model: 'unknown',
      totalCases: 1,
      passedCases: 1,
      failedCases: 0,
      cases: [
        expect.objectContaining({
          id: 'duplicate_shelf_resolution_regression',
          status: 'passed',
        }),
      ],
    });
  });
});

function noOpenAiConfigService(): ConfigService {
  return {
    get: jest.fn(() => undefined),
  } as unknown as ConfigService;
}

function buildDuplicateShelfCase(): ProductCompareRealLifeCase {
  return {
    id: 'duplicate_shelf_resolution_regression',
    title: 'Evaluation runner resolves shelf products for comparison',
    goal: ProductCompareGoal.NewProductDecision,
    anchor: {
      kind: ProductCompareItemKind.CheckedProduct,
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'New Lab',
        name: 'Barrier Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Glycerin', 'Panthenol', 'Allantoin'],
      },
    },
    candidates: [
      {
        kind: ProductCompareItemKind.ShelfProduct,
        productId: 'owned-barrier-serum',
      },
    ],
    shelfProducts: [
      {
        id: 'owned-barrier-serum',
        brand: 'Shelf Lab',
        name: 'Current Barrier Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Glycerin', 'Panthenol', 'Allantoin'],
      },
    ],
    expected: {
      outcomes: [ProductCompareOutcome.NotEnoughData],
      reasonCodes: [ProductCompareReasonCode.NotEnoughData],
    },
  };
}
