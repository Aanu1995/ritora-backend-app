import { ProductCategory } from '../shelf/shelf.types';
import type {
  IngredientClassification,
  IngredientClassifierPort,
} from './ingredient-classifier.port';
import {
  IngredientIntelligenceService,
  MAX_UNIQUE_INGREDIENT_CLASSIFICATION_TOKENS_PER_ANALYSIS,
} from './ingredient-intelligence.service';
import {
  AnalysisSeverity,
  IngredientCategory,
  type ProductForAnalysis,
} from './ingredients.types';

function product(tokens: string[]): ProductForAnalysis {
  return {
    id: 'product-1',
    brand: 'Ritora',
    name: 'AI Classified Product',
    category: ProductCategory.Serum,
    inciIngredients: tokens,
  };
}

function classification(
  rawToken: string,
  category: IngredientCategory,
  overrides: Partial<IngredientClassification> = {},
): IngredientClassification {
  return {
    rawToken,
    canonicalName: rawToken,
    category,
    confidence: 0.8,
    summaryEn: `${rawToken} classified as ${category}.`,
    phSensitive: false,
    photosensitizing: false,
    requiresSpf: false,
    irritationRisk: false,
    overlapSeverity: AnalysisSeverity.Low,
    ...overrides,
  };
}

describe('IngredientIntelligenceService', () => {
  it('builds analysis matches from AI classifications without a seeded ingredient catalogue', async () => {
    const classifier: jest.Mocked<IngredientClassifierPort> = {
      classify: jest.fn().mockResolvedValue([
        classification('Retinol', IngredientCategory.Retinoid, {
          photosensitizing: true,
          requiresSpf: true,
          irritationRisk: true,
          overlapSeverity: AnalysisSeverity.High,
        }),
      ]),
    };
    const service = new IngredientIntelligenceService(classifier);

    const result = await service.matchProduct(
      product(['Water', 'Retinol', 'Fragrance']),
    );

    expect(classifier.classify).toHaveBeenCalledWith({
      tokens: ['Water', 'Retinol', 'Fragrance'],
    });
    expect(result.totalTokens).toBe(3);
    expect(result.resolvedTokens).toBe(1);
    expect(result.unresolvedTokens).toEqual(['Water', 'Fragrance']);
    expect(result.matchedIngredients).toEqual([
      expect.objectContaining({
        rawToken: 'Retinol',
        inferred: true,
        confidence: 0.8,
        ingredient: expect.objectContaining({
          displayNameEn: 'Retinol',
          category: IngredientCategory.Retinoid,
          photosensitizing: true,
          requiresSpf: true,
        }),
      }),
    ]);
  });

  it('classifies unique ingredient tokens once across multiple products', async () => {
    const classifier: jest.Mocked<IngredientClassifierPort> = {
      classify: jest
        .fn()
        .mockResolvedValue([
          classification('Retinol', IngredientCategory.Retinoid),
          classification('Glycolic Acid', IngredientCategory.Aha),
        ]),
    };
    const service = new IngredientIntelligenceService(classifier);

    const results = await service.matchProducts([
      product(['Retinol', 'Glycolic Acid']),
      { ...product(['Retinol']), id: 'product-2' },
    ]);

    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(classifier.classify).toHaveBeenCalledWith({
      tokens: ['Retinol', 'Glycolic Acid'],
    });
    expect(results).toHaveLength(2);
    expect(results[0].matchedIngredients).toHaveLength(2);
    expect(results[1].matchedIngredients).toHaveLength(1);
  });

  it('forwards privacy-safe AI usage tracking context to the classifier', async () => {
    const classifier: jest.Mocked<IngredientClassifierPort> = {
      classify: jest
        .fn()
        .mockResolvedValue([
          classification('Retinol', IngredientCategory.Retinoid),
        ]),
    };
    const service = new IngredientIntelligenceService(classifier);

    await service.matchProduct(product(['Retinol']), {
      productId: 'product-1',
      source: 'ingredient_product_analysis_worker',
      userId: 'user-1',
    });

    expect(classifier.classify).toHaveBeenCalledWith({
      tokens: ['Retinol'],
      tracking: {
        productId: 'product-1',
        source: 'ingredient_product_analysis_worker',
        userId: 'user-1',
      },
    });
  });

  it('fills common skincare actives with deterministic safety fallback when AI misses them', async () => {
    const classifier: jest.Mocked<IngredientClassifierPort> = {
      classify: jest.fn().mockResolvedValue([]),
    };
    const service = new IngredientIntelligenceService(classifier);

    const result = await service.matchProduct(
      product(['Retinol', 'Glycolic Acid', 'Zinc Oxide', 'Mystery Complex']),
    );

    expect(result.resolvedTokens).toBe(3);
    expect(result.unresolvedTokens).toEqual(['Mystery Complex']);
    expect(result.matchedIngredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rawToken: 'Retinol',
          ingredient: expect.objectContaining({
            category: IngredientCategory.Retinoid,
            requiresSpf: true,
          }),
        }),
        expect.objectContaining({
          rawToken: 'Glycolic Acid',
          ingredient: expect.objectContaining({
            category: IngredientCategory.Aha,
            irritationRisk: true,
          }),
        }),
        expect.objectContaining({
          rawToken: 'Zinc Oxide',
          ingredient: expect.objectContaining({
            category: IngredientCategory.MineralSpf,
          }),
        }),
      ]),
    );
  });

  it('caps unique classification tokens per analysis request to bound AI fanout', async () => {
    const classifier: jest.Mocked<IngredientClassifierPort> = {
      classify: jest.fn(async ({ tokens }) =>
        tokens.map((token) =>
          classification(token, IngredientCategory.Humectant),
        ),
      ),
    };
    const service = new IngredientIntelligenceService(classifier);
    const tokens = Array.from(
      {
        length: MAX_UNIQUE_INGREDIENT_CLASSIFICATION_TOKENS_PER_ANALYSIS + 5,
      },
      (_, index) => `Ingredient ${index + 1}`,
    );

    const [result] = await service.matchProducts([product(tokens)]);

    expect(classifier.classify).toHaveBeenCalledWith({
      tokens: tokens.slice(
        0,
        MAX_UNIQUE_INGREDIENT_CLASSIFICATION_TOKENS_PER_ANALYSIS,
      ),
    });
    expect(result.totalTokens).toBe(tokens.length);
    expect(result.resolvedTokens).toBe(
      MAX_UNIQUE_INGREDIENT_CLASSIFICATION_TOKENS_PER_ANALYSIS,
    );
    expect(result.unresolvedTokens).toEqual(
      tokens.slice(MAX_UNIQUE_INGREDIENT_CLASSIFICATION_TOKENS_PER_ANALYSIS),
    );
  });
});
