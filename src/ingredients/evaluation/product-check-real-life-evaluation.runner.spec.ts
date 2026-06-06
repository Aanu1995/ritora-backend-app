import { ConfigService } from '@nestjs/config';
import { ProductCategory } from '../../shelf/shelf.types';
import {
  ProductCheckSource,
  ProductCheckVerdict,
} from '../product-check.types';
import type {
  ProductCheckRealLifeCase,
  PhotoQuickCheckRealLifeCase,
} from './product-check-real-life-cases';
import type { PhotoQuickCheckEvaluationCaseResult } from './product-check-evaluation.types';

const mockCheckForUser = jest.fn();
const mockBuildProductCheckService = jest.fn(() => ({
  checkForUser: mockCheckForUser,
}));
const mockCreateEvaluationRuntime = jest.fn(() => ({
  analysisService: {
    analyze: jest.fn(),
  },
}));
const mockEvaluatePhotoQuickCheckCase = jest.fn();
const mockProductCheckAssertions = jest.fn(() => []);
const mockIngredientAnalysisAssertions = jest.fn(() => []);

jest.mock('./product-check-evaluation-runtime', () => ({
  buildProductCheckService: mockBuildProductCheckService,
  createEvaluationRuntime: mockCreateEvaluationRuntime,
}));

jest.mock('./product-check-photo-evaluation', () => ({
  evaluatePhotoQuickCheckCase: mockEvaluatePhotoQuickCheckCase,
}));

jest.mock('./product-check-evaluation-assertions', () => ({
  ingredientAnalysisAssertions: mockIngredientAnalysisAssertions,
  productCheckAssertions: mockProductCheckAssertions,
}));

import { evaluateProductCheckRealLifeCases } from './product-check-real-life-evaluation.runner';

describe('evaluateProductCheckRealLifeCases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckForUser.mockResolvedValue({});
    mockEvaluatePhotoQuickCheckCase.mockImplementation(
      (
        _runtime: unknown,
        evaluationCase: PhotoQuickCheckRealLifeCase,
        language: 'en' | 'sv',
        includeLanguageInCaseId: boolean,
      ): Promise<PhotoQuickCheckEvaluationCaseResult> =>
        Promise.resolve({
          kind: 'photo_quick_check',
          id: includeLanguageInCaseId
            ? `${evaluationCase.id}__${language}`
            : evaluationCase.id,
          title: includeLanguageInCaseId
            ? `${evaluationCase.title} [${language}]`
            : evaluationCase.title,
          language,
          status: 'passed',
          checks: [],
          extraction: null,
          output: null,
        }),
    );
  });

  it('runs product and photo Quick Check cases for every requested language', async () => {
    const productCase = buildProductCase();
    const photoCase = buildPhotoCase();

    const report = await evaluateProductCheckRealLifeCases({
      configService: new ConfigService(),
      productCases: [productCase],
      photoCases: [photoCase],
      ingredientCases: [],
      languages: ['en', 'sv'],
      generatedAt: new Date('2026-06-03T18:30:00.000Z'),
    });

    expect(report.quickCheckLanguages).toEqual(['en', 'sv']);
    expect(report.cases.map((result) => result.id)).toEqual([
      'test_product__en',
      'test_product__sv',
      'test_photo__en',
      'test_photo__sv',
    ]);
    expect(mockCheckForUser).toHaveBeenCalledTimes(2);
    expect(mockCheckForUser.mock.calls.map((call) => call[2])).toEqual([
      'en',
      'sv',
    ]);
    expect(mockEvaluatePhotoQuickCheckCase).toHaveBeenCalledWith(
      expect.anything(),
      photoCase,
      'en',
      true,
    );
    expect(mockEvaluatePhotoQuickCheckCase).toHaveBeenCalledWith(
      expect.anything(),
      photoCase,
      'sv',
      true,
    );
  });
});

function buildProductCase(): ProductCheckRealLifeCase {
  return {
    id: 'test_product',
    title: 'Test product',
    product: {
      source: ProductCheckSource.IngredientPaste,
      brand: 'Test',
      name: 'Barrier Cream',
      category: ProductCategory.Moisturizer,
      inciIngredients: ['Aqua', 'Glycerin'],
    },
    expected: {
      verdicts: [ProductCheckVerdict.IngredientsOnly],
    },
  };
}

function buildPhotoCase(): PhotoQuickCheckRealLifeCase {
  return {
    id: 'test_photo',
    title: 'Test photo',
    labelLines: ['Test', 'Barrier Cream', 'Aqua, Glycerin'],
    expectedExtraction: {},
    expected: {
      verdicts: [ProductCheckVerdict.IngredientsOnly],
    },
  };
}
