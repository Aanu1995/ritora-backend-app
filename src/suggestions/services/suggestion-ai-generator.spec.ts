import { ConfigService } from '@nestjs/config';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SuggestionEvidenceSourceId } from '../suggestions.constants';
import { SuggestionAiGenerator } from './suggestion-ai-generator';
import { SuggestionGenerationInputs } from './suggestion-ai-generator';
import { getSuggestionEvidenceSources } from './suggestion-evidence-sources';

describe('SuggestionAiGenerator', () => {
  it('uses the structured reaction context even when the journal flag has not been backfilled', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    const result = await generator.generate({
      slotId: 'slot-1',
      targetDate: '2026-04-29',
      targetTime: '08:00',
      daypart: 'morning',
      skinProfile: null,
      shelfActiveProducts: [],
      shelfFinishedProductIds: [],
      routineSteps: [],
      recentJournalEntries: [],
      recentApplications: [],
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
      contextSummary: {
        cacheKey: 'ctx',
        builtAt: '2026-04-29T06:00:00.000Z',
        targetDate: '2026-04-29',
        targetTime: '08:00',
        daypart: 'morning',
        skinProfile: {
          primaryGoal: null,
          skinType: null,
          sensitivityLevel: null,
          activeConcerns: [],
          pregnancyStatus: null,
        },
        reaction: {
          hasSignal: true,
          severity: 'moderate',
          confidence: 0.8,
          indicators: ['redness'],
          affectedZones: ['cheeks'],
          concernKeys: ['redness_inflammation'],
          daysSinceLatestSignal: 0,
          barrierCompromised: true,
        },
        productScores: [],
        applicationPatterns: {
          days: 0,
          skippedByCategory: {},
          substitutedByCategory: {},
          addedOffShelfCount: 0,
          editedLogCount: 0,
          adherenceByCategory: {},
        },
        safetyConstraints: ['barrier_recovery_mode'],
        governance: {
          safetyPolicyVersion: 'test-policy',
          safetyPolicyReviewedAt: '2026-05-04',
          aiPersonalizationAllowed: true,
          aiPersonalizationBlockedReason: null,
        },
        evidenceSources: [],
        skippedCandidates: [],
      },
    } satisfies SuggestionGenerationInputs);

    expect(result.hasReactionSignal).toBe(true);
    expect(result.metadata.model).toBe('deterministic-baseline');
    expect(result.safetyFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Recent reaction'),
        }),
      ]),
    );
  });

  it('falls back to source-backed AI-mode product suggestions when OpenAI is unavailable', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts('morning'),
    );

    expect(result.mode).toBe('ai');
    expect(result.metadata.model).toBe('deterministic-baseline');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'cleanser-1',
          stepLabel: ProductCategory.Cleanser,
          provenance: 'ai_added',
        }),
        expect.objectContaining({
          inventoryProductId: 'spf-1',
          stepLabel: ProductCategory.SunProtection,
          provenance: 'ai_added',
        }),
      ]),
    );
    expect(result.explanation.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Evidence',
        }),
      ]),
    );
  });

  it('keeps missing sunscreen as a trusted-source gap, never an invented step', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    const inputs = inputsWithScoredShelfProducts('morning');
    inputs.shelfActiveProducts = inputs.shelfActiveProducts.filter(
      (product) => product.id !== 'spf-1',
    );
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.filter(
        (score) => score.productId !== 'spf-1',
      );

    const result = await generator.generate(inputs);

    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepLabel: ProductCategory.SunProtection,
        }),
      ]),
    );
    expect(result.gapRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory: expect.stringContaining('sunscreen'),
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.AadSunscreenSelection,
          ]),
        }),
      ]),
    );
  });
});

function inputsWithScoredShelfProducts(
  daypart: 'morning' | 'noon' | 'evening',
): SuggestionGenerationInputs {
  const products = [
    product('cleanser-1', 'Soft Cleanser', ProductCategory.Cleanser),
    product('serum-1', 'Niacinamide Serum', ProductCategory.Serum),
    product('moisturizer-1', 'Barrier Cream', ProductCategory.Moisturizer),
    product('spf-1', 'Daily SPF 50', ProductCategory.SunProtection),
  ];
  return {
    slotId: 'slot-1',
    targetDate: '2026-04-29',
    targetTime: daypart === 'evening' ? '20:00' : '08:00',
    daypart,
    skinProfile: null,
    shelfActiveProducts: products,
    shelfFinishedProductIds: [],
    routineSteps: [],
    recentJournalEntries: [],
    recentApplications: [],
    aiPersonalizationAllowed: true,
    aiPersonalizationBlockedReason: null,
    contextSummary: {
      cacheKey: 'ctx-products',
      builtAt: '2026-04-29T06:00:00.000Z',
      targetDate: '2026-04-29',
      targetTime: daypart === 'evening' ? '20:00' : '08:00',
      daypart,
      skinProfile: {
        primaryGoal: 'barrier support',
        skinType: null,
        sensitivityLevel: null,
        activeConcerns: [],
        pregnancyStatus: null,
      },
      reaction: {
        hasSignal: false,
        severity: null,
        confidence: null,
        indicators: [],
        affectedZones: [],
        concernKeys: [],
        daysSinceLatestSignal: null,
        barrierCompromised: false,
      },
      productScores: [
        productScore('cleanser-1', ProductCategory.Cleanser, 88, []),
        productScore('serum-1', ProductCategory.Serum, 84, ['niacinamide']),
        productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
          'ceramide',
        ]),
        productScore('spf-1', ProductCategory.SunProtection, 92, ['spf']),
      ],
      applicationPatterns: {
        days: 0,
        skippedByCategory: {},
        substitutedByCategory: {},
        addedOffShelfCount: 0,
        editedLogCount: 0,
        adherenceByCategory: {},
      },
      safetyConstraints: ['daytime_spf_available'],
      governance: {
        safetyPolicyVersion: 'test-policy',
        safetyPolicyReviewedAt: '2026-05-04',
        aiPersonalizationAllowed: true,
        aiPersonalizationBlockedReason: null,
      },
      evidenceSources: getSuggestionEvidenceSources([
        SuggestionEvidenceSourceId.AadSunscreenSelection,
        SuggestionEvidenceSourceId.MayoDrySkinCare,
      ]),
      skippedCandidates: [],
    },
  };
}

function product(
  id: string,
  name: string,
  category: ProductCategory,
): InventoryProduct {
  return {
    id,
    user_id: 'user-1',
    brand: 'Ava Lab',
    name,
    category,
    status: ShelfStatus.Active,
    guidance: {
      applicationMethod: 'fingertips',
      quantity: 'pea-size',
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
  } as unknown as InventoryProduct;
}

function productScore(
  productId: string,
  category: ProductCategory,
  suitabilityScore: number,
  activeTags: string[],
) {
  return {
    productId,
    brand: 'Ava Lab',
    name: productId,
    category,
    preferredTimeOfDay: 'either' as const,
    activeTags,
    suitabilityScore,
    suitabilityReasons: ['matches this slot'],
    cautionReasons: [],
    waitMinutes: null,
    inciQuality: 'available' as const,
    dataQuality: 'verified' as const,
    dataQualityWarnings: [],
    evidenceSourceIds:
      category === ProductCategory.SunProtection
        ? [SuggestionEvidenceSourceId.AadSunscreenSelection]
        : [SuggestionEvidenceSourceId.MayoDrySkinCare],
  };
}
