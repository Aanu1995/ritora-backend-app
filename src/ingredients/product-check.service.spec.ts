import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import {
  LookupConfidence,
  LookupWarningCode,
  ProductCategory,
  ShelfStatus,
} from '../shelf/shelf.types';
import {
  AnalysisConfidence,
  AnalysisSeverity,
  IngredientCategory,
  AnalysisMode,
  AnalysisStatus,
  type AnalysisResult,
} from './ingredients.types';
import { ProductCheckService } from './product-check.service';
import {
  ProductCheckAiReviewStatus,
  ProductCheckAlternativeSource,
  ProductCheckContextSignal,
  ProductCheckNextAction,
  ProductCheckPersonalizationLevel,
  ProductCheckPurchaseGuidanceReasonCode,
  ProductCheckReasonCode,
  ProductCheckSource,
  ProductCheckTone,
  ProductCheckVerdict,
} from './product-check.types';

const analysis: AnalysisResult = {
  mode: AnalysisMode.Multi,
  status: AnalysisStatus.Ok,
  confidence: AnalysisConfidence.High,
  safetyScore: 94,
  actives: [],
  conflicts: [],
  overlaps: [],
  layeringOrder: [],
  productsMissingInci: [],
  engineVersion: 'test',
  generatedAt: '2026-05-17T10:00:00.000Z',
};

const focusAnalysis: AnalysisResult = {
  ...analysis,
  safetyScore: null,
  actives: [
    {
      slug: 'niacinamide',
      displayName: 'Niacinamide',
      category: IngredientCategory.Niacinamide,
      summary: 'Supports the barrier and helps uneven tone.',
      avoidCategories: [],
      avoidIngredients: [],
      mitigationHint: null,
    },
  ],
};

const defaultContext = {
  level: ProductCheckPersonalizationLevel.Personalized,
  usedSignals: [ProductCheckContextSignal.SkinProfile],
  missingSignals: [],
  activeShelfProductCount: 0,
  recentJournalReactionCount: 0,
  recentSuggestionReactionCount: 0,
};

const defaultPurchaseGuidance = {
  shouldConsiderAlternatives: false,
  reasonCodes: [],
  alternatives: [],
};

describe('ProductCheckService', () => {
  const analysisContext = {
    loadForUser: jest.fn(),
  };
  const analysisService = {
    analyze: jest.fn(),
  };
  const matchingService = {
    matchProduct: jest.fn(),
  };
  const verdictService = {
    buildVerdict: jest.fn(),
  };
  const aiReviewProvider = {
    review: jest.fn(),
  };
  const contextService = {
    loadForUser: jest.fn(),
  };
  const reactionEvidenceService = {
    loadForUser: jest.fn(),
  };
  const purchaseGuidanceService = {
    loadForUser: jest.fn(),
  };
  const inventoryRepository = {
    find: jest.fn(),
  };
  let service: ProductCheckService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductCheckService(
      analysisContext as never,
      analysisService as never,
      matchingService as never,
      verdictService as never,
      aiReviewProvider,
      contextService as never,
      reactionEvidenceService as never,
      purchaseGuidanceService as never,
      inventoryRepository as never,
    );
    analysisContext.loadForUser.mockResolvedValue(null);
    analysisService.analyze.mockImplementation(({ focusProductId }) =>
      Promise.resolve(focusProductId ? focusAnalysis : analysis),
    );
    inventoryRepository.find.mockResolvedValue([]);
    contextService.loadForUser.mockResolvedValue({
      context: defaultContext,
      activeConsentTypes: new Set(),
    });
    reactionEvidenceService.loadForUser.mockResolvedValue([]);
    purchaseGuidanceService.loadForUser.mockResolvedValue(
      defaultPurchaseGuidance,
    );
    aiReviewProvider.review.mockResolvedValue({
      status: ProductCheckAiReviewStatus.Unavailable,
      confidence: AnalysisConfidence.Low,
      suggestedVerdict: null,
      reasonCodes: [],
      ingredientNames: [],
      summary: null,
      reviewedAt: '2026-05-17T10:00:00.000Z',
    });
    matchingService.matchProduct.mockReturnValue({
      totalTokens: 1,
      resolvedTokens: 1,
      unresolvedTokens: [],
      matchedIngredients: [
        {
          ingredient: {
            slug: 'niacinamide',
            displayNameEn: 'Niacinamide',
            category: 'niacinamide',
          },
          confidence: 1,
        },
      ],
    });
    verdictService.buildVerdict.mockReturnValue({
      label: ProductCheckVerdict.GoodFit,
      tone: ProductCheckTone.Positive,
      confidence: AnalysisConfidence.High,
      safetyScore: 94,
      reasons: [],
      nextAction: ProductCheckNextAction.UseAsPlanned,
      generatedAt: '2026-05-17T10:00:00.000Z',
    });
  });

  it('checks an unsaved product against the scoped skin profile without persisting it', async () => {
    const skinProfile = Object.assign(new SkinProfile(), {
      skin_type: 'sensitive',
      reaction_history: {},
    });
    analysisContext.loadForUser.mockResolvedValue(skinProfile);

    const result = await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'Ritora Lab',
          name: 'Barrier Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Niacinamide'],
          reviewRequired: false,
        },
      },
      'en',
    );

    expect(analysisContext.loadForUser).toHaveBeenCalledWith('user-1');
    const multiCall = analysisService.analyze.mock.calls.find(
      ([input]) => !input.focusProductId,
    );
    expect(multiCall?.[0]).toEqual({
      products: [
        expect.objectContaining({
          id: 'checked-product',
          brand: 'Ritora Lab',
          name: 'Barrier Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Niacinamide'],
        }),
      ],
      skinProfile,
      language: 'en',
      withExplanations: true,
    });
    expect(inventoryRepository.find).toHaveBeenCalledWith({
      where: { user_id: 'user-1', status: ShelfStatus.Active },
      order: { created_at: 'DESC' },
      take: 50,
    });
    expect(contextService.loadForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      skinProfile,
      activeShelfProducts: [],
    });
    expect(reactionEvidenceService.loadForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        product: expect.objectContaining({ id: 'checked-product' }),
        inventoryProducts: [],
      }),
    );
    expect(result.analysis).toEqual(
      expect.objectContaining({
        safetyScore: 100,
        actives: focusAnalysis.actives,
      }),
    );
    expect(result.reactionEvidence).toEqual([]);
    expect(result.purchaseGuidance).toEqual(defaultPurchaseGuidance);
    expect(result.context).toEqual(defaultContext);
    expect(inventoryRepository).not.toHaveProperty('save');
  });

  it('passes educational context into verdict mapping when no personal data is available', async () => {
    contextService.loadForUser.mockResolvedValue({
      context: {
        ...defaultContext,
        level: ProductCheckPersonalizationLevel.Educational,
        usedSignals: [],
        missingSignals: Object.values(ProductCheckContextSignal),
      },
      activeConsentTypes: new Set(),
    });

    const result = await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'Ritora Lab',
          name: 'Barrier Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Niacinamide'],
        },
      },
      'en',
    );

    expect(result.context.level).toBe(
      ProductCheckPersonalizationLevel.Educational,
    );
    expect(verdictService.buildVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        hasPersonalContext: false,
        hasReactionContext: false,
      }),
    );
  });

  it('runs AI verdict review with minimized checked-product context', async () => {
    const reviewedVerdict = {
      label: ProductCheckVerdict.UseCarefully,
      tone: ProductCheckTone.Caution,
      confidence: AnalysisConfidence.Medium,
      safetyScore: 88,
      reasons: [
        {
          code: ProductCheckReasonCode.ReactionTrigger,
          severity: AnalysisSeverity.Medium,
          ingredientNames: ['Niacinamide'],
          conflictCode: null,
        },
      ],
      nextAction: ProductCheckNextAction.ReviewAndPatchTest,
      generatedAt: '2026-05-17T10:00:00.000Z',
    };
    const aiReview = {
      status: ProductCheckAiReviewStatus.Reviewed,
      confidence: AnalysisConfidence.Medium,
      suggestedVerdict: ProductCheckVerdict.UseCarefully,
      reasonCodes: [ProductCheckReasonCode.ReactionTrigger],
      ingredientNames: ['Niacinamide'],
      summary: 'Review with patch-test caution.',
      reviewedAt: '2026-05-17T10:00:00.000Z',
    };
    aiReviewProvider.review.mockResolvedValue(aiReview);
    verdictService.buildVerdict
      .mockReturnValueOnce({
        label: ProductCheckVerdict.GoodFit,
        tone: ProductCheckTone.Positive,
        confidence: AnalysisConfidence.High,
        safetyScore: 94,
        reasons: [],
        nextAction: ProductCheckNextAction.UseAsPlanned,
        generatedAt: '2026-05-17T10:00:00.000Z',
      })
      .mockReturnValueOnce(reviewedVerdict);

    const result = await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'Ritora Lab',
          name: 'Barrier Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Niacinamide'],
        },
      },
      'en',
    );

    expect(aiReviewProvider.review).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'en',
        product: expect.objectContaining({
          id: 'checked-product',
          inciIngredients: ['Niacinamide'],
        }),
        matchedIngredientNames: ['Niacinamide'],
        unresolvedIngredientTokens: [],
        baselineVerdict: expect.objectContaining({
          label: ProductCheckVerdict.GoodFit,
        }),
      }),
    );
    expect(verdictService.buildVerdict).toHaveBeenLastCalledWith(
      expect.objectContaining({ aiReview }),
    );
    expect(result.aiReview).toBe(aiReview);
    expect(result.verdict).toBe(reviewedVerdict);
  });

  it('compares checked products against active shelf context for redundancy and conflicts', async () => {
    inventoryRepository.find.mockResolvedValue([
      {
        id: 'shelf-1',
        brand: 'Shelf Lab',
        name: 'Retinol Serum',
        category: ProductCategory.Serum,
        status: ShelfStatus.Active,
        identity: {
          brand: 'Shelf Lab',
          name: 'Retinol Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Retinol'],
        },
      },
    ]);

    await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.PhotoExtraction,
          category: ProductCategory.Other,
          inciIngredients: ['Glycolic Acid'],
          lookupConfidence: LookupConfidence.Low,
          reviewRequired: false,
        },
      },
      'en',
    );

    const multiCall = analysisService.analyze.mock.calls.find(
      ([input]) => !input.focusProductId,
    );
    expect(multiCall?.[0].products).toEqual([
      expect.objectContaining({ id: 'checked-product' }),
      expect.objectContaining({
        id: 'shelf-1',
        brand: 'Shelf Lab',
        name: 'Retinol Serum',
        inciIngredients: ['Retinol'],
      }),
    ]);
    expect(verdictService.buildVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupConfidence: undefined,
      }),
    );
  });

  it('does not let Shelf metadata review flags downgrade photo Quick Check verdicts', async () => {
    await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.PhotoExtraction,
          category: ProductCategory.Moisturizer,
          inciIngredients: ['Aqua', 'Glycerin', 'Dimethicone'],
          lookupConfidence: LookupConfidence.Low,
          lookupWarnings: [
            LookupWarningCode.ReviewRequired,
            LookupWarningCode.PartialData,
            LookupWarningCode.AiNormalized,
            LookupWarningCode.GuidanceUnverified,
          ],
          reviewRequired: true,
        },
      },
      'en',
    );

    expect(verdictService.buildVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupConfidence: undefined,
        reviewRequired: false,
      }),
    );
  });

  it('does not carry photo ingredient save-review warnings into Quick Check verdict inputs', async () => {
    await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.PhotoExtraction,
          category: ProductCategory.Moisturizer,
          inciIngredients: ['Aqua', 'Glycerin', 'Dimethicone'],
          lookupConfidence: LookupConfidence.Low,
          lookupWarnings: [LookupWarningCode.IngredientsUnverified],
          reviewRequired: true,
        },
      },
      'en',
    );

    expect(verdictService.buildVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupConfidence: undefined,
        reviewRequired: false,
      }),
    );
  });

  it('filters verdict analysis to findings involving the checked product', async () => {
    analysisService.analyze.mockImplementation(({ focusProductId }) =>
      Promise.resolve(
        focusProductId
          ? focusAnalysis
          : {
              ...analysis,
              safetyScore: 42,
              conflicts: [
                {
                  id: 'shelf-only-conflict',
                  code: 'RETINOID_AHA',
                  severity: AnalysisSeverity.High,
                  ingredientA: 'Retinol',
                  ingredientB: 'Glycolic acid',
                  productAId: 'shelf-1',
                  productBId: 'shelf-2',
                  explanation: null,
                  description: 'Shelf products conflict with each other.',
                },
                {
                  id: 'checked-routine-conflict',
                  code: 'AHA_BHA',
                  severity: AnalysisSeverity.Medium,
                  ingredientA: 'Citric acid',
                  ingredientB: 'Salicylic acid',
                  productAId: 'checked-product',
                  productBId: 'shelf-2',
                  explanation: null,
                  description: 'The checked product may clash with the shelf.',
                },
              ],
              overlaps: [
                {
                  id: 'shelf-only-overlap',
                  ingredient: 'Retinol',
                  productIds: ['shelf-1', 'shelf-2'],
                  severity: AnalysisSeverity.High,
                  explanation: null,
                  description: 'Shelf products duplicate each other.',
                },
              ],
            },
      ),
    );

    const result = await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'CeraVe',
          name: 'Moisturising Lotion',
          category: ProductCategory.Moisturizer,
          inciIngredients: ['Citric acid'],
        },
      },
      'en',
    );

    expect(result.analysis.conflicts).toEqual([
      expect.objectContaining({
        id: 'checked-routine-conflict',
      }),
    ]);
    expect(result.analysis.overlaps).toEqual([]);
    expect(result.analysis.safetyScore).toBe(92);
    expect(verdictService.buildVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis: expect.objectContaining({
          conflicts: [
            expect.objectContaining({ id: 'checked-routine-conflict' }),
          ],
          overlaps: [],
          safetyScore: 92,
        }),
      }),
    );
  });

  it('passes delegated reaction evidence into verdict mapping', async () => {
    reactionEvidenceService.loadForUser.mockResolvedValue([
      {
        kind: 'shelf_reaction_signal',
        confidence: AnalysisConfidence.Medium,
        productName: 'Ritora Lab Barrier Serum',
        ingredientNames: ['Niacinamide'],
        reactionSignalCount: 1,
        usageDaysLast90: 1,
      },
    ]);

    const result = await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'Ritora Lab',
          name: 'Barrier Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Aqua', 'Niacinamide'],
        },
      },
      'en',
    );

    expect(result.reactionEvidence).toHaveLength(1);
    expect(verdictService.buildVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        reactionEvidenceCount: 1,
      }),
    );
  });

  it('returns delegated purchase guidance after the final verdict is known', async () => {
    const purchaseGuidance = {
      shouldConsiderAlternatives: true,
      reasonCodes: [ProductCheckPurchaseGuidanceReasonCode.SmartPicksAvailable],
      alternatives: [
        {
          id: 'pick-1',
          source: ProductCheckAlternativeSource.SmartPicks,
          brand: 'Calm Lab',
          productName: 'Barrier Cream',
          ingredientOrCategory: 'Barrier moisturizer',
          budgetTier: 'mid' as const,
          sellerNames: ['Pharmacy'],
          reason: 'Covers a barrier gap without duplicating actives.',
        },
      ],
    };
    purchaseGuidanceService.loadForUser.mockResolvedValue(purchaseGuidance);
    verdictService.buildVerdict.mockReturnValue({
      label: ProductCheckVerdict.UseCarefully,
      tone: ProductCheckTone.Caution,
      confidence: AnalysisConfidence.High,
      safetyScore: 76,
      reasons: [],
      nextAction: ProductCheckNextAction.ReviewSmartPicks,
      generatedAt: '2026-05-17T10:00:00.000Z',
    });

    const result = await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'Ritora Lab',
          name: 'Strong Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Niacinamide'],
        },
      },
      'en',
    );

    expect(purchaseGuidanceService.loadForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        verdictLabel: ProductCheckVerdict.UseCarefully,
      }),
    );
    expect(result.purchaseGuidance).toBe(purchaseGuidance);
  });

  it('passes no matched-ingredient verdict signals for unmatched products', async () => {
    matchingService.matchProduct.mockReturnValue({
      totalTokens: 1,
      resolvedTokens: 0,
      unresolvedTokens: ['Mystery Complex'],
      matchedIngredients: [],
    });

    await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'Ritora Lab',
          name: 'Unknown Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Mystery Complex'],
        },
      },
      'en',
    );

    expect(verdictService.buildVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        matchedIngredientCount: 0,
      }),
    );
  });

  it('keeps verdict confidence scoped to the checked product instead of noisy shelf context', async () => {
    analysisService.analyze.mockImplementation(({ focusProductId }) =>
      Promise.resolve(
        focusProductId
          ? focusAnalysis
          : { ...analysis, confidence: AnalysisConfidence.Low },
      ),
    );

    await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'Ritora Lab',
          name: 'Clear INCI Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Niacinamide'],
        },
      },
      'en',
    );

    expect(verdictService.buildVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis: expect.objectContaining({
          confidence: AnalysisConfidence.High,
        }),
      }),
    );
  });

  it('uses product-check confidence metrics for complete INCI lists with partial catalog coverage', async () => {
    matchingService.matchProduct.mockReturnValue({
      totalTokens: 25,
      resolvedTokens: 1,
      unresolvedTokens: ['Aqua', 'Cetearyl Alcohol', 'Dimethicone'],
      matchedIngredients: [
        {
          ingredient: {
            slug: 'glycerin',
            displayNameEn: 'Glycerin',
            category: 'humectant',
          },
          confidence: 1,
        },
      ],
    });

    await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'CeraVe',
          name: 'Moisturising Lotion',
          category: ProductCategory.Moisturizer,
          inciIngredients: [
            'Aqua',
            'Glycerin',
            'Caprylic/Capric Triglyceride',
            'Cetearyl Alcohol',
            'Dimethicone',
            'Phenoxyethanol',
          ],
        },
      },
      'en',
    );

    expect(verdictService.buildVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis: expect.objectContaining({
          confidence: AnalysisConfidence.Medium,
        }),
        matchedIngredientCount: 1,
      }),
    );
  });

  it('does not over-penalize the checked product for the same routine clash across several shelf products', async () => {
    analysisService.analyze.mockImplementation(({ focusProductId }) =>
      Promise.resolve(
        focusProductId
          ? focusAnalysis
          : {
              ...analysis,
              safetyScore: 55,
              conflicts: [
                {
                  id: 'AZELAIC_AHA:checked-product:azelaic:citric:azelaic',
                  code: 'AZELAIC_AHA',
                  severity: AnalysisSeverity.Medium,
                  ingredientA: 'Citric acid',
                  ingredientB: 'Azelaic acid',
                  productAId: 'checked-product',
                  productBId: 'azelaic-serum',
                  conditions: {},
                  description: 'Acids can stack irritation risk.',
                  explanation: null,
                },
                {
                  id: 'AHA_BHA:checked-product:bha:citric:salicylic',
                  code: 'AHA_BHA',
                  severity: AnalysisSeverity.Medium,
                  ingredientA: 'Citric acid',
                  ingredientB: 'Salicylic acid',
                  productAId: 'checked-product',
                  productBId: 'bha-toner',
                  conditions: {},
                  description: 'Acids can stack irritation risk.',
                  explanation: null,
                },
                {
                  id: 'AHA_BHA:checked-product:willow:citric:willow',
                  code: 'AHA_BHA',
                  severity: AnalysisSeverity.Medium,
                  ingredientA: 'Citric acid',
                  ingredientB: 'Willow bark extract',
                  productAId: 'checked-product',
                  productBId: 'willow-toner',
                  conditions: {},
                  description: 'Acids can stack irritation risk.',
                  explanation: null,
                },
              ],
            },
      ),
    );

    await service.checkForUser(
      'user-1',
      {
        product: {
          source: ProductCheckSource.IngredientPaste,
          brand: 'CeraVe',
          name: 'Moisturising Lotion',
          category: ProductCategory.Moisturizer,
          inciIngredients: ['Glycerin', 'Citric Acid', 'Ceramide NP'],
        },
      },
      'en',
    );

    const verdictInput = verdictService.buildVerdict.mock.calls[0][0];
    expect(verdictInput.analysis.safetyScore).toBeGreaterThanOrEqual(60);
    expect(verdictInput.analysis.safetyScore).toBeLessThan(100);
  });
});
