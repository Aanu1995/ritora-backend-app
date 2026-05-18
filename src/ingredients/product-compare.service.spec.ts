import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductCategory, ShelfStatus } from '../shelf/shelf.types';
import {
  AnalysisConfidence,
  AnalysisMode,
  AnalysisSeverity,
  AnalysisStatus,
  IngredientCategory,
  type AnalysisResult,
} from './ingredients.types';
import { ProductCompareService } from './product-compare.service';
import {
  ProductCompareAiReviewStatus,
  ProductCompareGoal,
  ProductCompareItemKind,
  ProductCompareOutcome,
  ProductCompareReasonCode,
} from './product-compare.types';
import {
  ProductCheckAiReviewStatus,
  ProductCheckContextSignal,
  ProductCheckNextAction,
  ProductCheckPersonalizationLevel,
  ProductCheckSource,
  ProductCheckTone,
  ProductCheckVerdict,
  type ProductCheckEvaluation,
  type ProductCheckProductInput,
} from './product-check.types';

const context = {
  level: ProductCheckPersonalizationLevel.Personalized,
  usedSignals: [ProductCheckContextSignal.SkinProfile],
  missingSignals: [],
  activeShelfProductCount: 1,
  recentJournalReactionCount: 0,
  recentSuggestionReactionCount: 0,
};

const baseAnalysis: AnalysisResult = {
  mode: AnalysisMode.Multi,
  status: AnalysisStatus.Ok,
  confidence: AnalysisConfidence.High,
  safetyScore: 95,
  actives: [
    {
      slug: 'glycerin',
      displayName: 'Glycerin',
      category: IngredientCategory.Humectant,
      summary: 'Hydrating support.',
      avoidCategories: [],
      avoidIngredients: [],
      mitigationHint: null,
    },
  ],
  conflicts: [],
  overlaps: [],
  layeringOrder: [],
  productsMissingInci: [],
  engineVersion: 'test',
  generatedAt: '2026-05-18T10:00:00.000Z',
};

function productInput(
  overrides: Partial<ProductCheckProductInput> = {},
): ProductCheckProductInput {
  return {
    source: ProductCheckSource.IngredientPaste,
    brand: 'Ritora Lab',
    name: 'Barrier Cream',
    category: ProductCategory.Moisturizer,
    inciIngredients: ['Aqua', 'Glycerin', 'Ceramide NP'],
    ...overrides,
  };
}

function shelfProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shelf-1',
    user_id: 'user-1',
    brand: 'Shelf Lab',
    name: 'Daily Moisturizer',
    category: ProductCategory.Moisturizer,
    status: ShelfStatus.Active,
    identity: {
      brand: 'Shelf Lab',
      name: 'Daily Moisturizer',
      category: ProductCategory.Moisturizer,
      inciIngredients: ['Aqua', 'Glycerin', 'Ceramide NP'],
    },
    ...overrides,
  };
}

function evaluation(
  product: ProductCheckProductInput,
  overrides: Partial<ProductCheckEvaluation> = {},
): ProductCheckEvaluation {
  const label =
    overrides.response?.verdict.label ?? ProductCheckVerdict.GoodFit;
  const confidence =
    overrides.response?.verdict.confidence ?? AnalysisConfidence.High;
  const safetyScore = overrides.response?.verdict.safetyScore ?? 95;

  return {
    product: {
      id: 'checked-product',
      brand: product.brand ?? '',
      name: product.name ?? 'Checked product',
      category: product.category,
      inciIngredients: product.inciIngredients,
    },
    match: {
      product: {
        id: 'checked-product',
        brand: product.brand ?? '',
        name: product.name ?? 'Checked product',
        category: product.category,
        inciIngredients: product.inciIngredients,
      },
      matchedIngredients: product.inciIngredients.map((ingredient) => ({
        ingredient: {
          slug: ingredient.toLowerCase().replace(/\s+/g, '-'),
          displayNameEn: ingredient,
          summaryEn: `${ingredient} summary`,
          category: IngredientCategory.Humectant,
          aliases: [],
          categoryPatterns: [],
          overlapSeverity: AnalysisSeverity.Low,
        },
        rawToken: ingredient,
        normalizedSlug: ingredient.toLowerCase().replace(/\s+/g, '-'),
        concentrationPct: null,
        confidence: 1,
        inferred: false,
      })),
      unresolvedTokens: [],
      totalTokens: product.inciIngredients.length,
      resolvedTokens: product.inciIngredients.length,
    },
    response: {
      context,
      analysis: {
        ...baseAnalysis,
        confidence,
        safetyScore,
        conflicts: overrides.response?.analysis.conflicts ?? [],
        overlaps: overrides.response?.analysis.overlaps ?? [],
      },
      verdict: {
        label,
        tone: ProductCheckTone.Positive,
        confidence,
        safetyScore,
        reasons: [],
        nextAction: ProductCheckNextAction.UseAsPlanned,
        generatedAt: '2026-05-18T10:00:00.000Z',
      },
      aiReview: {
        status: ProductCheckAiReviewStatus.Unavailable,
        confidence: AnalysisConfidence.Low,
        suggestedVerdict: null,
        reasonCodes: [],
        ingredientNames: [],
        summary: null,
        reviewedAt: '2026-05-18T10:00:00.000Z',
      },
      reactionEvidence: [],
      purchaseGuidance: {
        shouldConsiderAlternatives: false,
        reasonCodes: [],
        alternatives: [],
      },
    },
    reactionTriggerIngredients: [],
    photosensitizingIngredients: [],
    activeShelfProducts: [],
    activeShelfInventoryProducts: [],
    ...overrides,
  };
}

describe('ProductCompareService', () => {
  const productCheckService = {
    evaluateForUser: jest.fn(),
  };
  const analysisService = {
    analyze: jest.fn(),
  };
  const analysisContext = {
    loadForUser: jest.fn(),
  };
  const inventoryRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const aiReviewProvider = {
    review: jest.fn(),
  };
  let service: ProductCompareService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductCompareService(
      productCheckService as never,
      analysisService as never,
      analysisContext as never,
      inventoryRepository as never,
      aiReviewProvider,
    );
    inventoryRepository.findOne.mockResolvedValue(shelfProduct());
    analysisContext.loadForUser.mockResolvedValue(null);
    analysisService.analyze.mockResolvedValue({
      ...baseAnalysis,
      conflicts: [],
      overlaps: [],
    });
    productCheckService.evaluateForUser.mockImplementation(
      async (
        _userId: string,
        product: ProductCheckProductInput,
      ): Promise<ProductCheckEvaluation> => evaluation(product),
    );
    aiReviewProvider.review.mockResolvedValue({
      status: ProductCompareAiReviewStatus.Unavailable,
      confidence: AnalysisConfidence.Low,
      preferredItemId: null,
      reasonCodes: [],
      summary: null,
      reviewedAt: '2026-05-18T10:00:00.000Z',
    });
  });

  it('compares a checked product with an owned shelf product using the shared Quick Check evaluator', async () => {
    const result = await service.compareForUser(
      'user-1',
      {
        anchor: {
          kind: ProductCompareItemKind.CheckedProduct,
          product: productInput({ name: 'New Barrier Cream' }),
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
        ],
      },
      'en',
    );

    expect(inventoryRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'shelf-1', user_id: 'user-1' },
    });
    expect(productCheckService.evaluateForUser).toHaveBeenCalledTimes(2);
    expect(productCheckService.evaluateForUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'New Barrier Cream' }),
      'en',
      { excludeShelfProductIds: ['shelf-1'] },
    );
    expect(result.goal).toBe(ProductCompareGoal.NewProductDecision);
    expect(result.context).toEqual(context);
    expect(result.items).toHaveLength(2);
    expect(inventoryRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a shelf-only request sent as a new-product decision', async () => {
    await expect(
      service.compareForUser(
        'user-1',
        {
          goal: ProductCompareGoal.NewProductDecision,
          anchor: {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
          candidates: [
            {
              kind: ProductCompareItemKind.ShelfProduct,
              productId: 'shelf-2',
            },
          ],
        },
        'en',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects shelf products that are not owned by the current user', async () => {
    inventoryRepository.findOne.mockResolvedValue(null);

    await expect(
      service.compareForUser(
        'user-1',
        {
          anchor: {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
          candidates: [
            {
              kind: ProductCompareItemKind.ShelfProduct,
              productId: 'shelf-2',
            },
          ],
        },
        'en',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns replacement guidance instead of a winner for a highly similar product already on the shelf', async () => {
    const result = await service.compareForUser(
      'user-1',
      {
        anchor: {
          kind: ProductCompareItemKind.CheckedProduct,
          product: productInput({
            brand: 'New Lab',
            name: 'Ceramide Lotion',
            inciIngredients: ['Aqua', 'Glycerin', 'Ceramide NP'],
          }),
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
        ],
      },
      'en',
    );

    expect(result.comparison.outcome).toBe(ProductCompareOutcome.NoClearWinner);
    expect(result.comparison.winnerItemId).toBeNull();
    expect(result.comparison.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCompareReasonCode.AlreadyOwned,
        }),
        expect.objectContaining({
          code: ProductCompareReasonCode.ReplacementOnly,
        }),
      ]),
    );
  });

  it('uses owned-product wording for highly similar shelf products', async () => {
    const result = await service.compareForUser(
      'user-1',
      {
        goal: ProductCompareGoal.ShelfRoutineDecision,
        anchor: {
          kind: ProductCompareItemKind.ShelfProduct,
          productId: 'shelf-1',
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-2',
          },
        ],
      },
      'en',
    );

    expect(result.goal).toBe(ProductCompareGoal.ShelfRoutineDecision);
    expect(result.comparison.summary).toContain('Keep both');
    expect(result.comparison.summary).not.toContain('worth buying');
  });

  it('treats a safe different-role checked product as worth considering, not a forced replacement', async () => {
    inventoryRepository.findOne.mockResolvedValue(
      shelfProduct({
        category: ProductCategory.Moisturizer,
        identity: {
          brand: 'Shelf Lab',
          name: 'Daily Moisturizer',
          category: ProductCategory.Moisturizer,
          inciIngredients: ['Aqua', 'Glycerin', 'Ceramide NP'],
        },
      }),
    );

    const result = await service.compareForUser(
      'user-1',
      {
        goal: ProductCompareGoal.NewProductDecision,
        anchor: {
          kind: ProductCompareItemKind.CheckedProduct,
          product: productInput({
            name: 'Brightening Serum',
            category: ProductCategory.Serum,
            inciIngredients: ['Aqua', 'Niacinamide', 'Zinc PCA'],
          }),
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
        ],
      },
      'en',
    );

    expect(result.comparison.outcome).toBe(ProductCompareOutcome.ChooseAnchor);
    expect(result.comparison.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCompareReasonCode.FillsRoutineGap,
        }),
        expect.objectContaining({
          code: ProductCompareReasonCode.DifferentRoutineRoles,
        }),
      ]),
    );
  });

  it('warns instead of forcing a winner when a different-role checked product conflicts with the shelf', async () => {
    analysisService.analyze.mockResolvedValueOnce({
      ...baseAnalysis,
      conflicts: [
        {
          id: 'direct-conflict',
          code: 'RETINOID_AHA',
          severity: AnalysisSeverity.High,
          ingredientA: 'Retinol',
          ingredientB: 'Glycolic Acid',
          productAId: 'anchor',
          productBId: 'candidate-1',
          explanation: null,
          description: 'Do not layer these together.',
        },
      ],
      overlaps: [],
    });
    inventoryRepository.findOne.mockResolvedValue(
      shelfProduct({
        category: ProductCategory.Treatment,
        identity: {
          brand: 'Shelf Lab',
          name: 'Retinol Treatment',
          category: ProductCategory.Treatment,
          inciIngredients: ['Aqua', 'Retinol'],
        },
      }),
    );

    const result = await service.compareForUser(
      'user-1',
      {
        goal: ProductCompareGoal.NewProductDecision,
        anchor: {
          kind: ProductCompareItemKind.CheckedProduct,
          product: productInput({
            name: 'AHA Toner',
            category: ProductCategory.Exfoliant,
            inciIngredients: ['Aqua', 'Glycolic Acid'],
          }),
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
        ],
      },
      'en',
    );

    expect(result.comparison.outcome).toBe(ProductCompareOutcome.NoClearWinner);
    expect(result.comparison.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCompareReasonCode.RoutineConflict,
          severity: AnalysisSeverity.High,
        }),
        expect.objectContaining({
          code: ProductCompareReasonCode.UseTogetherCarefully,
        }),
      ]),
    );
  });

  it('allows a duplicate checked product to win only as a replacement when it is clearly safer', async () => {
    productCheckService.evaluateForUser
      .mockResolvedValueOnce(
        evaluation(
          productInput({
            name: 'Gentler Ceramide Lotion',
            inciIngredients: ['Aqua', 'Glycerin', 'Ceramide NP'],
          }),
        ),
      )
      .mockResolvedValueOnce(
        evaluation(productInput({ name: 'Old Ceramide Lotion' }), {
          response: {
            ...evaluation(productInput()).response,
            analysis: {
              ...baseAnalysis,
              confidence: AnalysisConfidence.High,
              safetyScore: 45,
              conflicts: [],
              overlaps: [],
            },
            verdict: {
              ...evaluation(productInput()).response.verdict,
              label: ProductCheckVerdict.AvoidForProfile,
              safetyScore: 45,
            },
          },
        }),
      );

    const result = await service.compareForUser(
      'user-1',
      {
        goal: ProductCompareGoal.NewProductDecision,
        anchor: {
          kind: ProductCompareItemKind.CheckedProduct,
          product: productInput({
            name: 'Gentler Ceramide Lotion',
            inciIngredients: ['Aqua', 'Glycerin', 'Ceramide NP'],
          }),
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
        ],
      },
      'en',
    );

    expect(result.comparison.outcome).toBe(ProductCompareOutcome.ChooseAnchor);
    expect(result.comparison.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCompareReasonCode.ReplacementOnly,
        }),
      ]),
    );
  });

  it('does not force a winner for different-role shelf products that can coexist', async () => {
    inventoryRepository.findOne
      .mockResolvedValueOnce(
        shelfProduct({
          id: 'shelf-1',
          category: ProductCategory.Moisturizer,
          identity: {
            brand: 'Shelf Lab',
            name: 'Daily Moisturizer',
            category: ProductCategory.Moisturizer,
            inciIngredients: ['Aqua', 'Glycerin', 'Ceramide NP'],
          },
        }),
      )
      .mockResolvedValueOnce(
        shelfProduct({
          id: 'shelf-2',
          category: ProductCategory.SunProtection,
          identity: {
            brand: 'SPF Lab',
            name: 'Mineral SPF',
            category: ProductCategory.SunProtection,
            inciIngredients: ['Zinc Oxide', 'Dimethicone'],
          },
        }),
      );

    const result = await service.compareForUser(
      'user-1',
      {
        goal: ProductCompareGoal.ShelfRoutineDecision,
        anchor: {
          kind: ProductCompareItemKind.ShelfProduct,
          productId: 'shelf-1',
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-2',
          },
        ],
      },
      'en',
    );

    expect(result.comparison.outcome).toBe(ProductCompareOutcome.NoClearWinner);
    expect(result.comparison.reasons).toEqual([
      expect.objectContaining({
        code: ProductCompareReasonCode.DifferentRoutineRoles,
      }),
    ]);
  });

  it('answers use-together safety for different-role shelf products with direct conflicts', async () => {
    analysisService.analyze.mockResolvedValueOnce({
      ...baseAnalysis,
      conflicts: [
        {
          id: 'owned-conflict',
          code: 'RETINOID_AHA',
          severity: AnalysisSeverity.High,
          ingredientA: 'Retinol',
          ingredientB: 'Glycolic Acid',
          productAId: 'anchor',
          productBId: 'candidate-1',
          explanation: null,
          description: 'Do not layer these together.',
        },
      ],
      overlaps: [],
    });
    inventoryRepository.findOne
      .mockResolvedValueOnce(
        shelfProduct({
          id: 'shelf-1',
          category: ProductCategory.Treatment,
          identity: {
            brand: 'Shelf Lab',
            name: 'Retinol Treatment',
            category: ProductCategory.Treatment,
            inciIngredients: ['Aqua', 'Retinol'],
          },
        }),
      )
      .mockResolvedValueOnce(
        shelfProduct({
          id: 'shelf-2',
          category: ProductCategory.Exfoliant,
          identity: {
            brand: 'Acid Lab',
            name: 'AHA Toner',
            category: ProductCategory.Exfoliant,
            inciIngredients: ['Aqua', 'Glycolic Acid'],
          },
        }),
      );

    const result = await service.compareForUser(
      'user-1',
      {
        goal: ProductCompareGoal.ShelfRoutineDecision,
        anchor: {
          kind: ProductCompareItemKind.ShelfProduct,
          productId: 'shelf-1',
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-2',
          },
        ],
      },
      'en',
    );

    expect(result.comparison.outcome).toBe(ProductCompareOutcome.NoClearWinner);
    expect(result.comparison.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCompareReasonCode.RoutineConflict,
          ingredientNames: ['Retinol', 'Glycolic Acid'],
        }),
        expect.objectContaining({
          code: ProductCompareReasonCode.UseTogetherCarefully,
        }),
      ]),
    );
  });

  it('chooses the safer product when deterministic scores clearly differ', async () => {
    productCheckService.evaluateForUser
      .mockResolvedValueOnce(
        evaluation(
          productInput({
            brand: 'Strong Lab',
            name: 'Retinol Peel',
            inciIngredients: ['Retinol', 'Glycolic Acid'],
          }),
          {
            response: {
              ...evaluation(productInput()).response,
              analysis: {
                ...baseAnalysis,
                confidence: AnalysisConfidence.High,
                safetyScore: 58,
                conflicts: [
                  {
                    id: 'high-conflict',
                    code: 'RETINOID_AHA',
                    severity: AnalysisSeverity.High,
                    ingredientA: 'Retinol',
                    ingredientB: 'Glycolic Acid',
                    productAId: 'checked-product',
                    productBId: 'checked-product',
                    explanation: null,
                    description: 'High irritation pairing.',
                  },
                ],
              },
              verdict: {
                ...evaluation(productInput()).response.verdict,
                label: ProductCheckVerdict.AvoidForProfile,
                safetyScore: 58,
              },
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        evaluation(productInput({ name: 'Gentle Lotion' })),
      );

    const result = await service.compareForUser(
      'user-1',
      {
        anchor: {
          kind: ProductCompareItemKind.CheckedProduct,
          product: productInput({
            name: 'Retinol Peel',
            inciIngredients: ['Retinol', 'Glycolic Acid'],
          }),
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
        ],
      },
      'en',
    );

    expect(result.comparison.outcome).toBe(
      ProductCompareOutcome.ChooseCandidate,
    );
    expect(result.comparison.winnerItemId).toBe('candidate-1');
    expect(result.comparison.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCompareReasonCode.LowerConflict,
        }),
      ]),
    );
  });

  it('does not choose a winner when any compared product has insufficient data', async () => {
    productCheckService.evaluateForUser.mockResolvedValueOnce(
      evaluation(productInput({ inciIngredients: ['Mystery Complex'] }), {
        response: {
          ...evaluation(productInput()).response,
          analysis: {
            ...baseAnalysis,
            status: AnalysisStatus.Ok,
            confidence: AnalysisConfidence.Low,
            safetyScore: null,
          },
          verdict: {
            ...evaluation(productInput()).response.verdict,
            label: ProductCheckVerdict.NotEnoughData,
            confidence: AnalysisConfidence.Low,
            safetyScore: null,
          },
        },
      }),
    );

    const result = await service.compareForUser(
      'user-1',
      {
        anchor: {
          kind: ProductCompareItemKind.CheckedProduct,
          product: productInput({ inciIngredients: ['Mystery Complex'] }),
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
        ],
      },
      'en',
    );

    expect(result.comparison.outcome).toBe(ProductCompareOutcome.NotEnoughData);
    expect(result.comparison.winnerItemId).toBeNull();
  });

  it('uses AI review as an explainer without overriding deterministic guardrails', async () => {
    aiReviewProvider.review.mockResolvedValue({
      status: ProductCompareAiReviewStatus.Reviewed,
      confidence: AnalysisConfidence.High,
      preferredItemId: 'candidate-1',
      reasonCodes: [ProductCompareReasonCode.BetterFit],
      summary: 'The shelf product is the better fit because it is gentler.',
      reviewedAt: '2026-05-18T10:00:00.000Z',
    });

    const result = await service.compareForUser(
      'user-1',
      {
        anchor: {
          kind: ProductCompareItemKind.CheckedProduct,
          product: productInput(),
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-1',
          },
        ],
      },
      'en',
    );

    expect(aiReviewProvider.review).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'en',
        goal: ProductCompareGoal.NewProductDecision,
        items: expect.arrayContaining([
          expect.objectContaining({ itemId: 'anchor' }),
          expect.objectContaining({ itemId: 'candidate-1' }),
        ]),
      }),
    );
    expect(result.aiReview.status).toBe(ProductCompareAiReviewStatus.Reviewed);
    expect(result.comparison.outcome).toBe(ProductCompareOutcome.NoClearWinner);
    expect(result.comparison.winnerItemId).toBeNull();
    expect(result.comparison.summary).toBe(
      'The shelf product is the better fit because it is gentler.',
    );
  });

  it('does not use buying language from AI review for shelf-only comparisons', async () => {
    aiReviewProvider.review.mockResolvedValue({
      status: ProductCompareAiReviewStatus.Reviewed,
      confidence: AnalysisConfidence.High,
      preferredItemId: null,
      reasonCodes: [ProductCompareReasonCode.AlreadyOwned],
      summary: 'You should buy candidate-1 because it looks better.',
      reviewedAt: '2026-05-18T10:00:00.000Z',
    });

    const result = await service.compareForUser(
      'user-1',
      {
        goal: ProductCompareGoal.ShelfRoutineDecision,
        anchor: {
          kind: ProductCompareItemKind.ShelfProduct,
          productId: 'shelf-1',
        },
        candidates: [
          {
            kind: ProductCompareItemKind.ShelfProduct,
            productId: 'shelf-2',
          },
        ],
      },
      'en',
    );

    expect(result.comparison.summary.toLowerCase()).not.toContain('buy');
    expect(result.comparison.summary).toContain('Keep both');
  });
});
