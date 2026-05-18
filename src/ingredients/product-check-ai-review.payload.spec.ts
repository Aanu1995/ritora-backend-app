import { ProductCategory } from '../shelf/shelf.types';
import {
  AnalysisConfidence,
  AnalysisMode,
  AnalysisSeverity,
  AnalysisStatus,
  IngredientCategory,
  type AnalysisResult,
} from './ingredients.types';
import { sanitizeProductCheckAiReview } from './product-check-ai-review.payload';
import type { ProductCheckAiReviewInput } from './product-check-ai-review.port';
import {
  ProductCheckContextSignal,
  ProductCheckNextAction,
  ProductCheckPersonalizationLevel,
  ProductCheckReasonCode,
  ProductCheckTone,
  ProductCheckVerdict,
} from './product-check.types';

const analysis: AnalysisResult = {
  mode: AnalysisMode.Multi,
  status: AnalysisStatus.Ok,
  confidence: AnalysisConfidence.High,
  safetyScore: 84,
  actives: [
    {
      slug: 'citric-acid',
      displayName: 'Citric acid',
      category: IngredientCategory.Aha,
      summary: 'A low-level acid.',
      avoidCategories: [],
      avoidIngredients: [],
      mitigationHint: null,
    },
  ],
  conflicts: [
    {
      id: 'AHA_BHA:checked-product:shelf-1:citric-acid:salicylic-acid',
      code: 'AHA_BHA',
      severity: AnalysisSeverity.Medium,
      ingredientA: 'Citric acid',
      ingredientB: 'Salicylic acid',
      productAId: 'checked-product',
      productBId: 'shelf-1',
      description: 'Acids can stack irritation risk.',
      mitigation: 'Separate routines.',
      conditions: {},
      explanation: null,
    },
  ],
  overlaps: [],
  layeringOrder: [],
  productsMissingInci: [],
  engineVersion: 'test',
  generatedAt: '2026-05-18T08:00:00.000Z',
};

describe('sanitizeProductCheckAiReview', () => {
  it('filters impossible AI reason codes for the supplied context', () => {
    const review = sanitizeProductCheckAiReview(
      {
        suggestedVerdict: ProductCheckVerdict.UseCarefully,
        confidence: AnalysisConfidence.Medium,
        reasonCodes: [
          ProductCheckReasonCode.MediumConflict,
          ProductCheckReasonCode.MissingPersonalContext,
        ],
        ingredientNames: ['Citric acid', 'Invented ingredient'],
        summary:
          'Citric acid may clash with an exfoliating shelf product, so space it out.',
      },
      buildInput(),
    );

    expect(review.reasonCodes).toEqual([ProductCheckReasonCode.MediumConflict]);
    expect(review.ingredientNames).toEqual(['Citric acid']);
  });

  it('drops suggested verdicts that would bypass ingredient-only guardrails', () => {
    const input = buildInput();
    input.analysis = {
      ...analysis,
      conflicts: [],
      safetyScore: 100,
    };
    input.context = {
      level: ProductCheckPersonalizationLevel.Educational,
      usedSignals: [],
      missingSignals: Object.values(ProductCheckContextSignal),
      activeShelfProductCount: 0,
      recentJournalReactionCount: 0,
      recentSuggestionReactionCount: 0,
    };
    input.baselineVerdict = {
      ...input.baselineVerdict,
      label: ProductCheckVerdict.IngredientsOnly,
      tone: ProductCheckTone.Neutral,
      reasons: [
        {
          code: ProductCheckReasonCode.MissingPersonalContext,
          severity: null,
          ingredientNames: [],
          conflictCode: null,
        },
      ],
    };

    const review = sanitizeProductCheckAiReview(
      {
        suggestedVerdict: ProductCheckVerdict.AvoidForProfile,
        confidence: AnalysisConfidence.Medium,
        reasonCodes: [ProductCheckReasonCode.MissingPersonalContext],
        ingredientNames: ['Citric acid'],
        summary:
          'There is no personal context, so this should stay educational.',
      },
      input,
    );

    expect(review.suggestedVerdict).toBeNull();
    expect(review.reasonCodes).toEqual([
      ProductCheckReasonCode.MissingPersonalContext,
    ]);
  });

  it('falls back to the baseline confidence when AI confidence is missing or invalid', () => {
    const review = sanitizeProductCheckAiReview(
      {
        suggestedVerdict: ProductCheckVerdict.UseCarefully,
        reasonCodes: [ProductCheckReasonCode.MediumConflict],
        ingredientNames: ['Citric acid'],
        summary: 'Use with spacing because acids can stack.',
      },
      buildInput(),
    );

    expect(review.confidence).toBe(AnalysisConfidence.High);
  });
});

function buildInput(): ProductCheckAiReviewInput {
  return {
    language: 'en',
    product: {
      id: 'checked-product',
      brand: 'Ritora Lab',
      name: 'Barrier Cream',
      category: ProductCategory.Moisturizer,
      inciIngredients: ['Citric acid'],
    },
    analysis,
    context: {
      level: ProductCheckPersonalizationLevel.Personalized,
      usedSignals: [
        ProductCheckContextSignal.SkinProfile,
        ProductCheckContextSignal.ActiveShelf,
      ],
      missingSignals: [],
      activeShelfProductCount: 1,
      recentJournalReactionCount: 0,
      recentSuggestionReactionCount: 0,
    },
    baselineVerdict: {
      label: ProductCheckVerdict.UseCarefully,
      tone: ProductCheckTone.Caution,
      confidence: AnalysisConfidence.High,
      safetyScore: 84,
      reasons: [
        {
          code: ProductCheckReasonCode.MediumConflict,
          severity: AnalysisSeverity.Medium,
          ingredientNames: ['Citric acid', 'Salicylic acid'],
          conflictCode: 'AHA_BHA',
        },
      ],
      nextAction: ProductCheckNextAction.ReviewAndPatchTest,
      generatedAt: '2026-05-18T08:00:00.000Z',
    },
    matchedIngredientNames: ['Citric acid'],
    unresolvedIngredientTokens: [],
    reactionEvidence: [],
  };
}
