import { ProductCategory } from '../shelf/shelf.types';
import {
  EnvironmentAirQualityRisk,
  EnvironmentConfidence,
  EnvironmentHumidityBand,
  EnvironmentSeason,
  EnvironmentSignalKind,
  EnvironmentTemperatureBand,
  EnvironmentUvRisk,
  EnvironmentWaterHardness,
  EnvironmentWaterSensitivity,
} from './environment-intelligence.constants';
import type { EnvironmentContextSummary } from './environment-intelligence.types';
import { buildEnvironmentAdaptationPolicy } from './environment-adaptation-policy';
import { SuggestionEvidenceSourceId } from '../suggestions/suggestions.constants';

describe('EnvironmentAdaptationPolicy', () => {
  it('creates source-backed adaptation signals for high UV, dry air, pollution, and hard water', () => {
    const policy = buildEnvironmentAdaptationPolicy(environmentContext());

    expect(policy.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: EnvironmentSignalKind.HighUv,
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.OpenMeteoWeather,
            SuggestionEvidenceSourceId.AadSunscreenSelection,
          ]),
        }),
        expect.objectContaining({
          kind: EnvironmentSignalKind.ColdDry,
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.MayoDrySkinCare,
          ]),
        }),
        expect.objectContaining({
          kind: EnvironmentSignalKind.PollutionElevated,
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.OpenMeteoAirQuality,
          ]),
        }),
        expect.objectContaining({
          kind: EnvironmentSignalKind.HardWaterReported,
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.NationalEczemaSocietyHardWater,
          ]),
        }),
      ]),
    );
    expect(policy.safetyConstraints).toEqual(
      expect.arrayContaining([
        'environment_high_uv',
        'environment_barrier_support',
        'environment_pollution_cleanse',
        'environment_hard_water_gentle_cleanse',
      ]),
    );
    expect(policy.gapRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
        }),
        expect.objectContaining({
          ingredientOrCategory: 'Barrier-support moisturizer',
        }),
      ]),
    );
    expect(policy.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: EnvironmentSignalKind.SeasonalTransitionDryer,
        }),
        expect.objectContaining({
          kind: EnvironmentSignalKind.SeasonalTransitionUvRising,
        }),
      ]),
    );
  });

  it('adjusts category suitability without overriding specialist locks', () => {
    const policy = buildEnvironmentAdaptationPolicy(environmentContext());

    expect(policy.scoreCategory(ProductCategory.SunProtection)).toBeGreaterThan(
      0,
    );
    expect(policy.scoreCategory(ProductCategory.Moisturizer)).toBeGreaterThan(
      0,
    );
    expect(policy.scoreCategory(ProductCategory.Exfoliant)).toBeLessThan(0);
    expect(policy.scoreCategory(ProductCategory.Cleanser)).toBeGreaterThan(0);
  });
});

function environmentContext(): EnvironmentContextSummary {
  return {
    status: 'available',
    provider: 'open_meteo',
    generatedAt: '2026-05-08T10:00:00.000Z',
    locationPersonalized: true,
    season: EnvironmentSeason.Winter,
    temperatureCelsius: 2,
    temperatureBand: EnvironmentTemperatureBand.Cold,
    humidity: 24,
    humidityBand: EnvironmentHumidityBand.VeryDry,
    uvIndex: 7,
    uvRisk: EnvironmentUvRisk.High,
    airQualityIndex: 82,
    airQualityRisk: EnvironmentAirQualityRisk.Poor,
    pm25: 38,
    pm10: 80,
    pollenRisk: null,
    conditionLabel: 'Cold and dry',
    waterHardness: EnvironmentWaterHardness.Hard,
    waterSensitivity: EnvironmentWaterSensitivity.Confirmed,
    climateSensitivities: ['dry_air', 'pollution'],
    transitionSignals: [
      EnvironmentSignalKind.SeasonalTransitionDryer,
      EnvironmentSignalKind.SeasonalTransitionUvRising,
    ],
    confidence: EnvironmentConfidence.Provider,
    stale: false,
    sourceIds: [
      SuggestionEvidenceSourceId.OpenMeteoWeather,
      SuggestionEvidenceSourceId.OpenMeteoAirQuality,
    ],
  };
}
