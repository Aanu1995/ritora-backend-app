import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  ApplicationMethod,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfStatus,
} from '../../shelf/shelf.types';
import {
  EnvironmentAirQualityRisk,
  EnvironmentConfidence,
  EnvironmentHumidityBand,
  EnvironmentProviderName,
  EnvironmentSeason,
  EnvironmentStatus,
  EnvironmentTemperatureBand,
  EnvironmentUvRisk,
  EnvironmentWaterHardness,
  EnvironmentWaterSensitivity,
} from '../../environment-intelligence/environment-intelligence.constants';
import {
  assessProductDataQuality,
  scoreProductForSuggestion,
  SuggestionProductGoalFitReason,
} from './suggestion-product-intelligence';

describe('suggestion product intelligence', () => {
  it('marks incomplete shelf data as insufficient and lowers suitability', () => {
    const product = productWithData({
      category: ProductCategory.Other,
      inciIngredients: [],
      inciLastConfirmedAt: null,
      preferredTimeOfDay: null,
    });

    const quality = assessProductDataQuality(product);
    const score = scoreProductForSuggestion(product, {
      daypart: 'morning',
      primaryGoal: 'barrier support',
      sensitivityLevel: 'high',
      recentUseCount: 0,
      hasReactionSignal: false,
      lockedProductIds: new Set(),
      conservativeRestart: false,
    });

    expect(quality).toEqual(
      expect.objectContaining({
        quality: 'insufficient',
        warnings: expect.arrayContaining([
          'ingredient list missing',
          'product category needs review',
        ]),
      }),
    );
    expect(score.dataQuality).toBe('insufficient');
    expect(score.suitabilityScore).toBeLessThan(55);
  });

  it('marks verified product intelligence when INCI, timing, and guidance are present', () => {
    const product = productWithData({
      category: ProductCategory.Serum,
      inciIngredients: ['Niacinamide', 'Glycerin'],
      inciLastConfirmedAt: '2026-05-01',
      preferredTimeOfDay: PreferredTimeOfDay.Either,
    });
    product.guidance = {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.PeaSize,
      steps: ['Apply after cleansing'],
      cautions: [],
      waitMinutes: 2,
    };

    expect(assessProductDataQuality(product).quality).toBe('verified');
  });

  it('does not warn when optional timing hints are missing', () => {
    const product = productWithData({
      category: ProductCategory.Moisturizer,
      inciIngredients: ['Glycerin', 'Ceramide NP'],
      inciLastConfirmedAt: '2026-05-01',
      preferredTimeOfDay: null,
    });
    product.guidance = {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.PeaSize,
      steps: ['Apply to clean skin'],
      cautions: [],
      waitMinutes: null,
    };

    expect(assessProductDataQuality(product)).toEqual({
      quality: 'verified',
      warnings: [],
    });
  });

  it('trusts matched ingredient intelligence even when source confirmation date is absent', () => {
    const product = productWithData({
      category: ProductCategory.Treatment,
      inciIngredients: ['Water', 'Azelaic Acid', 'Tocopherol'],
      inciLastConfirmedAt: null,
      preferredTimeOfDay: null,
    });
    product.guidance = {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.AsNeeded,
      steps: ['Apply a small amount'],
      cautions: ['Use sun protection'],
      waitMinutes: null,
    };

    expect(
      assessProductDataQuality(product, ['azelaic_acid'], {
        matchedIngredientCount: 2,
        totalIngredientCount: 3,
      }),
    ).toEqual({
      quality: 'verified',
      warnings: [],
    });
  });

  it('warns when an INCI list has no matched key actives', () => {
    const product = productWithData({
      category: ProductCategory.SunProtection,
      inciIngredients: ['UVA/UVB filter', 'Licochalcone A'],
      inciLastConfirmedAt: '2026-05-01',
      preferredTimeOfDay: null,
    });
    product.guidance = {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.AsNeeded,
      steps: ['Apply generously'],
      cautions: [],
      waitMinutes: null,
    };

    expect(
      assessProductDataQuality(product, ['spf'], {
        matchedIngredientCount: 0,
        totalIngredientCount: 2,
      }),
    ).toEqual(
      expect.objectContaining({
        quality: 'partial',
        warnings: ['key active ingredients not matched'],
      }),
    );
  });

  it('uses environment context to rank sunscreen, moisturizers, and strong actives', () => {
    const sunscreenScore = scoreProductForSuggestion(
      productWithData({
        category: ProductCategory.SunProtection,
        inciIngredients: ['Zinc Oxide'],
        inciLastConfirmedAt: '2026-05-01',
        preferredTimeOfDay: null,
      }),
      scoringOptions({ environment: highUvDryEnvironment() }),
    );
    const moisturizerScore = scoreProductForSuggestion(
      productWithData({
        category: ProductCategory.Moisturizer,
        inciIngredients: ['Glycerin', 'Ceramide NP'],
        inciLastConfirmedAt: '2026-05-01',
        preferredTimeOfDay: null,
      }),
      scoringOptions({ environment: highUvDryEnvironment() }),
    );
    const exfoliantScore = scoreProductForSuggestion(
      productWithData({
        category: ProductCategory.Exfoliant,
        inciIngredients: ['Glycolic Acid'],
        inciLastConfirmedAt: '2026-05-01',
        preferredTimeOfDay: null,
      }),
      scoringOptions({ environment: highUvDryEnvironment() }),
    );

    expect(sunscreenScore.suitabilityReasons).toEqual(
      expect.arrayContaining(['high UV fit']),
    );
    expect(moisturizerScore.suitabilityReasons).toEqual(
      expect.arrayContaining(['dry air barrier support']),
    );
    expect(exfoliantScore.cautionReasons).toEqual(
      expect.arrayContaining(['dry air can make exfoliation feel harsher']),
    );
  });

  it('uses secondary goals, adherence, skips, substitutions, repeats, and expiry in ranking', () => {
    const product = productWithData({
      category: ProductCategory.Serum,
      inciIngredients: ['Niacinamide', 'Glycerin'],
      inciLastConfirmedAt: '2026-05-01',
      preferredTimeOfDay: PreferredTimeOfDay.Morning,
    });
    product.effective_expires_at = new Date('2026-05-03T00:00:00.000Z');

    const score = scoreProductForSuggestion(product, {
      daypart: 'morning',
      primaryGoal: 'acne control',
      secondaryGoals: ['barrier support'],
      sensitivityLevel: 'high',
      recentUseCount: 2,
      adherenceCount: 3,
      skipCount: 1,
      substitutionCount: 1,
      recentSameDaypartSuggestionCount: 1,
      hasReactionSignal: false,
      lockedProductIds: new Set(),
      conservativeRestart: false,
      targetDate: '2026-05-04',
    });

    expect(score.suitabilityReasons).toEqual(
      expect.arrayContaining([
        SuggestionProductGoalFitReason.SecondarySelectedGoal,
        'recently applied by user',
      ]),
    );
    expect(score.cautionReasons).toEqual(
      expect.arrayContaining([
        'recently skipped by user',
        'recently substituted by user',
        'recent same-daypart repeat',
        'product may be expired',
      ]),
    );
  });

  it('treats the skin profile main goal as a strong product-fit signal beyond literal word overlap', () => {
    const sunscreen = productWithData({
      category: ProductCategory.SunProtection,
      inciIngredients: ['Zinc Oxide'],
      inciLastConfirmedAt: '2026-05-01',
      preferredTimeOfDay: PreferredTimeOfDay.Morning,
      benefits: ['daily UV protection'],
      name: 'Mineral SPF 50',
    });
    const genericSerum = productWithData({
      category: ProductCategory.Serum,
      inciIngredients: ['Water'],
      inciLastConfirmedAt: '2026-05-01',
      preferredTimeOfDay: PreferredTimeOfDay.Morning,
      benefits: ['lightweight feel'],
      name: 'Simple Water Serum',
    });

    const sunscreenScore = scoreProductForSuggestion(sunscreen, {
      daypart: 'morning',
      primaryGoal: 'fade dark marks',
      secondaryGoals: ['redness'],
      sensitivityLevel: 'mid',
      recentUseCount: 0,
      hasReactionSignal: false,
      lockedProductIds: new Set(),
      conservativeRestart: false,
    });
    const genericScore = scoreProductForSuggestion(genericSerum, {
      daypart: 'morning',
      primaryGoal: 'fade dark marks',
      secondaryGoals: ['redness'],
      sensitivityLevel: 'mid',
      recentUseCount: 0,
      hasReactionSignal: false,
      lockedProductIds: new Set(),
      conservativeRestart: false,
    });

    expect(sunscreenScore.suitabilityReasons).toEqual(
      expect.arrayContaining([
        SuggestionProductGoalFitReason.PrimarySelectedGoal,
      ]),
    );
    expect(sunscreenScore.suitabilityScore).toBeGreaterThan(
      genericScore.suitabilityScore,
    );
  });
});

function scoringOptions(input: {
  environment: ReturnType<typeof highUvDryEnvironment>;
}) {
  return {
    daypart: 'morning' as const,
    primaryGoal: 'barrier support',
    sensitivityLevel: 'high',
    recentUseCount: 0,
    hasReactionSignal: false,
    lockedProductIds: new Set<string>(),
    conservativeRestart: false,
    environment: input.environment,
  };
}

function highUvDryEnvironment() {
  return {
    status: EnvironmentStatus.Available,
    provider: EnvironmentProviderName.OpenMeteo,
    generatedAt: '2026-05-08T06:00:00.000Z',
    locationPersonalized: true,
    season: EnvironmentSeason.Spring,
    temperatureCelsius: 12,
    temperatureBand: EnvironmentTemperatureBand.Cold,
    humidity: 28,
    humidityBand: EnvironmentHumidityBand.VeryDry,
    uvIndex: 7,
    uvRisk: EnvironmentUvRisk.High,
    airQualityIndex: 66,
    airQualityRisk: EnvironmentAirQualityRisk.Moderate,
    pm25: 20,
    pm10: 40,
    pollenRisk: null,
    conditionLabel: 'Dry and bright',
    waterHardness: EnvironmentWaterHardness.Hard,
    waterSensitivity: EnvironmentWaterSensitivity.Suspected,
    climateSensitivities: ['dry_air'],
    transitionSignals: [],
    confidence: EnvironmentConfidence.Provider,
    stale: false,
    sourceIds: [],
  };
}

function productWithData(input: {
  category: ProductCategory;
  inciIngredients: string[];
  inciLastConfirmedAt: string | null;
  preferredTimeOfDay: PreferredTimeOfDay | null;
  benefits?: string[];
  name?: string;
}): InventoryProduct {
  return {
    id: 'product-1',
    user_id: 'user-1',
    brand: 'Ava Lab',
    name: input.name ?? 'Barrier Serum',
    category: input.category,
    status: ShelfStatus.Active,
    identity: {
      inciIngredients: input.inciIngredients,
      inciLastConfirmedAt: input.inciLastConfirmedAt,
      benefits: input.benefits ?? ['barrier support'],
      suitedFor: [],
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    user_fields: {
      preferredTimeOfDay: input.preferredTimeOfDay,
    },
  } as unknown as InventoryProduct;
}
