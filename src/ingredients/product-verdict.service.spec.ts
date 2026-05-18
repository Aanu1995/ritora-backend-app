import {
  AnalysisConfidence,
  AnalysisMode,
  AnalysisSeverity,
  AnalysisStatus,
  type AnalysisResult,
} from './ingredients.types';
import {
  ProductCheckNextAction,
  ProductCheckAiReviewStatus,
  ProductCheckReasonCode,
  ProductCheckTone,
  ProductCheckVerdict,
} from './product-check.types';
import { ProductVerdictService } from './product-verdict.service';
import { LookupConfidence } from '../shelf/shelf.types';

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    mode: AnalysisMode.Multi,
    status: AnalysisStatus.Ok,
    confidence: AnalysisConfidence.High,
    safetyScore: 96,
    actives: [],
    conflicts: [],
    overlaps: [],
    layeringOrder: [],
    productsMissingInci: [],
    engineVersion: 'test',
    generatedAt: '2026-05-17T10:00:00.000Z',
    ...overrides,
  };
}

describe('ProductVerdictService', () => {
  const service = new ProductVerdictService();

  it('returns not enough data when ingredients cannot be analysed', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        status: AnalysisStatus.InsufficientData,
        confidence: AnalysisConfidence.Low,
        safetyScore: null,
        productsMissingInci: ['checked-product'],
      }),
      matchedIngredientCount: 0,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.NotEnoughData);
    expect(verdict.tone).toBe(ProductCheckTone.Neutral);
    expect(verdict.safetyScore).toBeNull();
    expect(verdict.nextAction).toBe(ProductCheckNextAction.ReviewIngredients);
    expect(verdict.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCheckReasonCode.InsufficientIngredients,
        }),
      ]),
    );
  });

  it('hides safety score when no ingredients matched even if analysis has a fallback score', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        status: AnalysisStatus.Ok,
        confidence: AnalysisConfidence.Low,
        safetyScore: 100,
      }),
      matchedIngredientCount: 0,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.NotEnoughData);
    expect(verdict.safetyScore).toBeNull();
  });

  it('returns avoid for profile when a high-severity conflict is present', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        safetyScore: 58,
        conflicts: [
          {
            id: 'retinoid:aha',
            code: 'RETINOID_AHA',
            severity: AnalysisSeverity.High,
            ingredientA: 'Retinol',
            ingredientB: 'Glycolic acid',
            productAId: 'checked-product',
            productBId: 'checked-product',
            explanation: null,
            description: 'Retinoids and AHAs can be too much together.',
          },
        ],
      }),
      matchedIngredientCount: 2,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.AvoidForProfile);
    expect(verdict.tone).toBe(ProductCheckTone.Danger);
    expect(verdict.nextAction).toBe(ProductCheckNextAction.SkipProduct);
    expect(verdict.reasons[0]).toEqual(
      expect.objectContaining({
        code: ProductCheckReasonCode.HighConflict,
        severity: AnalysisSeverity.High,
      }),
    );
  });

  it('prioritizes reaction and sensitive-profile reasons over extra conflicts', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        safetyScore: 70,
        conflicts: ['AHA_BHA', 'AZELAIC_AHA', 'VITAMIN_C_AHA'].map(
          (code, index) => ({
            id: `${code}:checked-product:shelf-${index}:a:b`,
            code,
            severity: AnalysisSeverity.Medium,
            ingredientA: `Active ${index}`,
            ingredientB: `Shelf active ${index}`,
            productAId: 'checked-product',
            productBId: `shelf-${index}`,
            explanation: null,
            description: 'This pairing can be too much together.',
          }),
        ),
      }),
      matchedIngredientCount: 4,
      reviewRequired: false,
      hasSensitiveProfile: true,
      reactionTriggerIngredients: ['Niacinamide'],
      photosensitizingIngredients: [],
    });

    expect(verdict.reasons).toHaveLength(3);
    expect(verdict.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        ProductCheckReasonCode.ReactionTrigger,
        ProductCheckReasonCode.SensitiveProfile,
      ]),
    );
  });

  it('does not turn routine-only conflicts into a do-not-buy verdict', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        safetyScore: 75,
        conflicts: [
          {
            id: 'retinoid:aha',
            code: 'RETINOID_AHA',
            severity: AnalysisSeverity.High,
            ingredientA: 'Retinol',
            ingredientB: 'Glycolic acid',
            productAId: 'checked-product',
            productBId: 'shelf-1',
            explanation: null,
            description: 'Retinoids and AHAs can be too much together.',
          },
        ],
      }),
      matchedIngredientCount: 2,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.UseCarefully);
    expect(verdict.nextAction).toBe(ProductCheckNextAction.ReviewAndPatchTest);
  });

  it('still returns avoid when the checked formula has an internal high conflict', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        safetyScore: 75,
        conflicts: [
          {
            id: 'retinoid:aha',
            code: 'RETINOID_AHA',
            severity: AnalysisSeverity.High,
            ingredientA: 'Retinol',
            ingredientB: 'Glycolic acid',
            productAId: 'checked-product',
            productBId: 'checked-product',
            explanation: null,
            description: 'Retinoids and AHAs can be too much together.',
          },
        ],
      }),
      matchedIngredientCount: 2,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.AvoidForProfile);
    expect(verdict.nextAction).toBe(ProductCheckNextAction.SkipProduct);
  });

  it('keeps a low score from routine-only conflicts below the avoid threshold', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        safetyScore: 55,
        conflicts: [
          {
            id: 'retinoid:aha',
            code: 'RETINOID_AHA',
            severity: AnalysisSeverity.High,
            ingredientA: 'Retinol',
            ingredientB: 'Glycolic acid',
            productAId: 'checked-product',
            productBId: 'shelf-1',
            explanation: null,
            description: 'Retinoids and AHAs can be too much together.',
          },
          {
            id: 'retinoid:bha',
            code: 'RETINOID_BHA',
            severity: AnalysisSeverity.High,
            ingredientA: 'Retinol',
            ingredientB: 'Salicylic acid',
            productAId: 'checked-product',
            productBId: 'shelf-2',
            explanation: null,
            description: 'Retinoids and BHAs can be too much together.',
          },
        ],
      }),
      matchedIngredientCount: 2,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.UseCarefully);
    expect(verdict.nextAction).toBe(ProductCheckNextAction.ReviewAndPatchTest);
  });

  it('returns use carefully for medium-risk or low-confidence results', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        confidence: AnalysisConfidence.Low,
        safetyScore: 72,
        conflicts: [
          {
            id: 'vitamin-c:aha',
            code: 'VITAMIN_C_AHA',
            severity: AnalysisSeverity.Medium,
            ingredientA: 'Vitamin C',
            ingredientB: 'Lactic acid',
            productAId: 'checked-product',
            productBId: 'checked-product',
            explanation: null,
            description: 'Acids can stack irritation risk.',
          },
        ],
      }),
      matchedIngredientCount: 2,
      reviewRequired: false,
      hasSensitiveProfile: true,
      reactionTriggerIngredients: ['Vitamin C'],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.UseCarefully);
    expect(verdict.tone).toBe(ProductCheckTone.Caution);
    expect(verdict.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: ProductCheckReasonCode.LowConfidence }),
        expect.objectContaining({
          code: ProductCheckReasonCode.ReactionTrigger,
          ingredientNames: ['Vitamin C'],
        }),
      ]),
    );
  });

  it('returns good with limits for medium confidence, review-required, or modest scores', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        confidence: AnalysisConfidence.Medium,
        safetyScore: 82,
      }),
      matchedIngredientCount: 3,
      reviewRequired: true,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: ['Retinal'],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.GoodWithLimits);
    expect(verdict.tone).toBe(ProductCheckTone.Caution);
    expect(verdict.nextAction).toBe(ProductCheckNextAction.ReviewAndPatchTest);
    expect(verdict.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCheckReasonCode.ReviewRequired,
        }),
        expect.objectContaining({
          code: ProductCheckReasonCode.PhotosensitizingActive,
          ingredientNames: ['Retinal'],
        }),
      ]),
    );
  });

  it('keeps low photo metadata confidence at medium when ingredients are analyzable', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        confidence: AnalysisConfidence.High,
        safetyScore: 90,
      }),
      matchedIngredientCount: 3,
      lookupConfidence: LookupConfidence.Low,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.GoodWithLimits);
    expect(verdict.confidence).toBe(AnalysisConfidence.Medium);
    expect(verdict.reasons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: ProductCheckReasonCode.LowConfidence }),
      ]),
    );
  });

  it('surfaces duplicate active exposure as money-saving Smart Picks context', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        safetyScore: 92,
        overlaps: [
          {
            id: 'niacinamide:checked-product,shelf-1',
            ingredient: 'Niacinamide',
            productIds: ['checked-product', 'shelf-1'],
            severity: AnalysisSeverity.Medium,
            explanation: null,
            description:
              'Niacinamide appears in more than one product in this routine.',
          },
        ],
      }),
      matchedIngredientCount: 3,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.GoodWithLimits);
    expect(verdict.nextAction).toBe(ProductCheckNextAction.ReviewSmartPicks);
    expect(verdict.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCheckReasonCode.DuplicateExposure,
          severity: AnalysisSeverity.Medium,
          ingredientNames: ['Niacinamide'],
        }),
      ]),
    );
  });

  it('returns ingredient guide only when no personal context is available', () => {
    const verdict = service.buildVerdict({
      analysis: analysis(),
      matchedIngredientCount: 4,
      hasPersonalContext: false,
      hasReactionContext: false,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.IngredientsOnly);
    expect(verdict.tone).toBe(ProductCheckTone.Neutral);
    expect(verdict.nextAction).toBe(ProductCheckNextAction.CompleteProfile);
    expect(verdict.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCheckReasonCode.MissingPersonalContext,
        }),
      ]),
    );
  });

  it('downgrades otherwise safe checks when reaction context is unavailable', () => {
    const verdict = service.buildVerdict({
      analysis: analysis(),
      matchedIngredientCount: 4,
      hasPersonalContext: true,
      hasReactionContext: false,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.GoodWithLimits);
    expect(verdict.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCheckReasonCode.MissingReactionContext,
        }),
      ]),
    );
  });

  it('uses recent journal and suggestion reactions as caution signals', () => {
    const verdict = service.buildVerdict({
      analysis: analysis(),
      matchedIngredientCount: 4,
      hasPersonalContext: true,
      hasReactionContext: true,
      recentJournalReactionCount: 1,
      recentSuggestionReactionCount: 1,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.UseCarefully);
    expect(verdict.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCheckReasonCode.RecentJournalReaction,
        }),
        expect.objectContaining({
          code: ProductCheckReasonCode.SuggestionHistoryReaction,
        }),
      ]),
    );
  });

  it('uses product-specific reaction evidence as a stronger caution signal', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        safetyScore: 90,
      }),
      matchedIngredientCount: 4,
      hasPersonalContext: true,
      hasReactionContext: true,
      reactionEvidenceCount: 1,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.UseCarefully);
    expect(verdict.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCheckReasonCode.ProductReactionSignal,
        }),
      ]),
    );
  });

  it('returns good fit for high-confidence products without findings', () => {
    const verdict = service.buildVerdict({
      analysis: analysis(),
      matchedIngredientCount: 4,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    expect(verdict.label).toBe(ProductCheckVerdict.GoodFit);
    expect(verdict.tone).toBe(ProductCheckTone.Positive);
    expect(verdict.nextAction).toBe(ProductCheckNextAction.UseAsPlanned);
    expect(verdict.reasons).toEqual([]);
  });

  it('uses AI review as a cautious escalator but not an optimistic override', () => {
    const escalated = service.buildVerdict({
      analysis: analysis({
        safetyScore: 90,
      }),
      matchedIngredientCount: 4,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
      aiReview: {
        status: ProductCheckAiReviewStatus.Reviewed,
        confidence: AnalysisConfidence.Medium,
        suggestedVerdict: ProductCheckVerdict.UseCarefully,
        reasonCodes: [ProductCheckReasonCode.ReactionTrigger],
        ingredientNames: ['Fragrance'],
        summary: 'Fragrance may matter for this user context.',
        reviewedAt: '2026-05-17T10:00:00.000Z',
      },
    });

    expect(escalated.label).toBe(ProductCheckVerdict.UseCarefully);
    expect(escalated.confidence).toBe(AnalysisConfidence.Medium);
    expect(escalated.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ProductCheckReasonCode.ReactionTrigger,
          ingredientNames: ['Fragrance'],
        }),
      ]),
    );

    const notDowngraded = service.buildVerdict({
      analysis: analysis({
        safetyScore: 52,
        conflicts: [
          {
            id: 'retinoid:aha',
            code: 'RETINOID_AHA',
            severity: AnalysisSeverity.High,
            ingredientA: 'Retinol',
            ingredientB: 'Glycolic acid',
            productAId: 'checked-product',
            productBId: 'checked-product',
            explanation: null,
            description: 'Retinoids and AHAs can be too much together.',
          },
        ],
      }),
      matchedIngredientCount: 4,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
      aiReview: {
        status: ProductCheckAiReviewStatus.Reviewed,
        confidence: AnalysisConfidence.High,
        suggestedVerdict: ProductCheckVerdict.GoodFit,
        reasonCodes: [],
        ingredientNames: [],
        summary: null,
        reviewedAt: '2026-05-17T10:00:00.000Z',
      },
    });

    expect(notDowngraded.label).toBe(ProductCheckVerdict.AvoidForProfile);
  });

  it('does not let AI mark a supported verdict low confidence without low-confidence evidence', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        safetyScore: 100,
      }),
      matchedIngredientCount: 4,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
      aiReview: {
        status: ProductCheckAiReviewStatus.Reviewed,
        confidence: AnalysisConfidence.Low,
        suggestedVerdict: ProductCheckVerdict.GoodWithLimits,
        reasonCodes: [ProductCheckReasonCode.ReviewRequired],
        ingredientNames: [],
        summary: 'Review product metadata, but ingredients are usable.',
        reviewedAt: '2026-05-17T10:00:00.000Z',
      },
    });

    expect(verdict.label).toBe(ProductCheckVerdict.GoodWithLimits);
    expect(verdict.safetyScore).toBe(100);
    expect(verdict.confidence).toBe(AnalysisConfidence.Medium);
    expect(verdict.reasons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: ProductCheckReasonCode.LowConfidence }),
      ]),
    );
  });

  it('aggregates repeated conflict-family reasons before returning the verdict', () => {
    const verdict = service.buildVerdict({
      analysis: analysis({
        safetyScore: 85,
        conflicts: [
          {
            id: 'aha-bha:citric:azelaic',
            code: 'AHA_BHA',
            severity: AnalysisSeverity.Medium,
            ingredientA: 'Citric acid',
            ingredientB: 'Azelaic acid',
            productAId: 'checked-product',
            productBId: 'shelf-1',
            explanation: null,
            description: 'AHAs and BHAs can stack irritation risk.',
          },
          {
            id: 'aha-bha:citric:salicylic',
            code: 'AHA_BHA',
            severity: AnalysisSeverity.Medium,
            ingredientA: 'Citric acid',
            ingredientB: 'Salicylic acid',
            productAId: 'checked-product',
            productBId: 'shelf-1',
            explanation: null,
            description: 'AHAs and BHAs can stack irritation risk.',
          },
          {
            id: 'aha-bha:citric:willow',
            code: 'AHA_BHA',
            severity: AnalysisSeverity.Medium,
            ingredientA: 'Citric acid',
            ingredientB: 'Willow bark extract',
            productAId: 'checked-product',
            productBId: 'shelf-1',
            explanation: null,
            description: 'AHAs and BHAs can stack irritation risk.',
          },
        ],
      }),
      matchedIngredientCount: 6,
      reviewRequired: false,
      hasSensitiveProfile: false,
      reactionTriggerIngredients: [],
      photosensitizingIngredients: [],
    });

    const conflictReasons = verdict.reasons.filter(
      (reason) => reason.code === ProductCheckReasonCode.MediumConflict,
    );

    expect(conflictReasons).toEqual([
      expect.objectContaining({
        code: ProductCheckReasonCode.MediumConflict,
        conflictCode: 'AHA_BHA',
        ingredientNames: [
          'Citric acid',
          'Azelaic acid',
          'Salicylic acid',
          'Willow bark extract',
        ],
      }),
    ]);
  });
});
