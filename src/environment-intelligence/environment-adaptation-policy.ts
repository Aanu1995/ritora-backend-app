import { ProductCategory } from '../shelf/shelf.types';
import {
  SuggestionEvidenceSourceId,
  SuggestionGapRecommendationJson,
} from '../suggestions/suggestions.constants';
import {
  EnvironmentAirQualityRisk,
  EnvironmentHumidityBand,
  EnvironmentSignalKind,
  EnvironmentTemperatureBand,
  EnvironmentUvRisk,
  EnvironmentWaterHardness,
  EnvironmentWaterSensitivity,
} from './environment-intelligence.constants';
import type {
  EnvironmentAlert,
  EnvironmentContextSummary,
  EnvironmentPolicyResult,
  EnvironmentSignal,
} from './environment-intelligence.types';

export function buildEnvironmentAdaptationPolicy(
  environment: EnvironmentContextSummary | null,
): EnvironmentPolicyResult {
  if (!environment) {
    return emptyPolicy();
  }

  const signals = buildSignals(environment);
  const alerts = buildAlerts(environment, signals);
  const safetyConstraints = signals.map((signal) =>
    safetyConstraintForSignal(signal.kind),
  );

  return {
    signals,
    alerts,
    safetyConstraints: Array.from(new Set(safetyConstraints)),
    gapRecommendations: buildEnvironmentGapRecommendations(environment),
    scoreCategory: (category) => scoreCategory(category, environment),
  };
}

export function isHighUvRisk(uvRisk: EnvironmentUvRisk): boolean {
  const highUvRisks: readonly EnvironmentUvRisk[] = [
    EnvironmentUvRisk.High,
    EnvironmentUvRisk.VeryHigh,
    EnvironmentUvRisk.Extreme,
  ];
  return highUvRisks.includes(uvRisk);
}

export function isDryHumidity(
  humidityBand: EnvironmentHumidityBand | null,
): boolean {
  return (
    humidityBand === EnvironmentHumidityBand.VeryDry ||
    humidityBand === EnvironmentHumidityBand.Dry
  );
}

export function isPoorAirQuality(risk: EnvironmentAirQualityRisk): boolean {
  return (
    risk === EnvironmentAirQualityRisk.Poor ||
    risk === EnvironmentAirQualityRisk.VeryPoor
  );
}

export function hasHardWaterConcern(
  environment: EnvironmentContextSummary,
): boolean {
  return (
    environment.waterHardness === EnvironmentWaterHardness.Hard ||
    environment.waterSensitivity === EnvironmentWaterSensitivity.Suspected ||
    environment.waterSensitivity === EnvironmentWaterSensitivity.Confirmed
  );
}

function buildSignals(
  environment: EnvironmentContextSummary,
): EnvironmentSignal[] {
  const signals: EnvironmentSignal[] = [];
  if (isHighUvRisk(environment.uvRisk)) {
    signals.push({
      kind: EnvironmentSignalKind.HighUv,
      severity: 'warning',
      message: 'UV is high enough to make sunscreen a priority.',
      sourceIds: [
        SuggestionEvidenceSourceId.OpenMeteoWeather,
        SuggestionEvidenceSourceId.AadSunscreenSelection,
      ],
    });
  }
  if (isDryHumidity(environment.humidityBand)) {
    signals.push({
      kind: EnvironmentSignalKind.LowHumidity,
      severity: 'info',
      message: 'Dry air can make skin feel tighter.',
      sourceIds: [
        SuggestionEvidenceSourceId.OpenMeteoWeather,
        SuggestionEvidenceSourceId.MayoDrySkinCare,
      ],
    });
  }
  if (
    isDryHumidity(environment.humidityBand) &&
    (environment.temperatureBand === EnvironmentTemperatureBand.Cold ||
      environment.temperatureBand === EnvironmentTemperatureBand.Freezing)
  ) {
    signals.push({
      kind: EnvironmentSignalKind.ColdDry,
      severity: 'warning',
      message: 'Cold dry weather favors barrier support.',
      sourceIds: [
        SuggestionEvidenceSourceId.OpenMeteoWeather,
        SuggestionEvidenceSourceId.MayoDrySkinCare,
      ],
    });
  }
  if (
    environment.humidityBand === EnvironmentHumidityBand.Humid ||
    environment.humidityBand === EnvironmentHumidityBand.VeryHumid
  ) {
    if (
      environment.temperatureBand === EnvironmentTemperatureBand.Warm ||
      environment.temperatureBand === EnvironmentTemperatureBand.Hot
    ) {
      signals.push({
        kind: EnvironmentSignalKind.HotHumid,
        severity: 'info',
        message: 'Hot humid weather favors lighter layers.',
        sourceIds: [SuggestionEvidenceSourceId.OpenMeteoWeather],
      });
    }
  }
  if (isPoorAirQuality(environment.airQualityRisk)) {
    signals.push({
      kind: EnvironmentSignalKind.PollutionElevated,
      severity: 'warning',
      message:
        'Air quality is elevated, so cleansing and barrier support matter.',
      sourceIds: [SuggestionEvidenceSourceId.OpenMeteoAirQuality],
    });
  }
  if (hasHardWaterConcern(environment)) {
    signals.push({
      kind: EnvironmentSignalKind.HardWaterReported,
      severity: 'info',
      message: 'Reported hard-water sensitivity favors gentler cleansing.',
      sourceIds: [SuggestionEvidenceSourceId.NationalEczemaSocietyHardWater],
    });
  }
  return dedupeSignals(signals);
}

function buildAlerts(
  environment: EnvironmentContextSummary,
  signals: EnvironmentSignal[],
): EnvironmentAlert[] {
  const alerts: EnvironmentAlert[] = [];
  if (
    environment.transitionSignals.includes(
      EnvironmentSignalKind.SeasonalTransitionDryer,
    ) ||
    signals.some((signal) => signal.kind === EnvironmentSignalKind.ColdDry)
  ) {
    alerts.push({
      kind: EnvironmentSignalKind.SeasonalTransitionDryer,
      title: 'Dry air is rising',
      message:
        'Ritora will keep today’s routine more barrier-focused and go slower with exfoliation.',
      sourceIds: [
        SuggestionEvidenceSourceId.OpenMeteoWeather,
        SuggestionEvidenceSourceId.MayoDrySkinCare,
      ],
    });
  }
  if (
    environment.transitionSignals.includes(
      EnvironmentSignalKind.SeasonalTransitionUvRising,
    )
  ) {
    alerts.push({
      kind: EnvironmentSignalKind.SeasonalTransitionUvRising,
      title: 'UV is increasing',
      message: 'Ritora will make daytime sunscreen checks stricter.',
      sourceIds: [
        SuggestionEvidenceSourceId.OpenMeteoWeather,
        SuggestionEvidenceSourceId.AadSunscreenSelection,
      ],
    });
  }
  return alerts;
}

function buildEnvironmentGapRecommendations(
  environment: EnvironmentContextSummary,
): SuggestionGapRecommendationJson[] {
  const gaps: SuggestionGapRecommendationJson[] = [];
  if (isHighUvRisk(environment.uvRisk)) {
    gaps.push({
      ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
      reason: 'High UV makes daily sunscreen important.',
      budgetTier: null,
      goalAlignment: 'sun protection',
      sourceIds: [
        SuggestionEvidenceSourceId.OpenMeteoWeather,
        SuggestionEvidenceSourceId.AadSunscreenSelection,
      ],
    });
  }
  if (
    isDryHumidity(environment.humidityBand) ||
    hasHardWaterConcern(environment)
  ) {
    gaps.push({
      ingredientOrCategory: 'Barrier-support moisturizer',
      reason: 'Dry air or hard-water sensitivity can increase tightness.',
      budgetTier: null,
      goalAlignment: 'barrier support',
      sourceIds: [
        SuggestionEvidenceSourceId.MayoDrySkinCare,
        SuggestionEvidenceSourceId.NationalEczemaSocietyHardWater,
      ],
    });
  }
  return gaps;
}

function scoreCategory(
  category: ProductCategory,
  environment: EnvironmentContextSummary,
): number {
  let score = 0;
  if (
    category === ProductCategory.SunProtection &&
    isHighUvRisk(environment.uvRisk)
  ) {
    score += 18;
  }
  if (
    category === ProductCategory.Moisturizer &&
    isDryHumidity(environment.humidityBand)
  ) {
    score += 14;
  }
  if (
    category === ProductCategory.Moisturizer &&
    hasHardWaterConcern(environment)
  ) {
    score += 8;
  }
  if (
    category === ProductCategory.Cleanser &&
    isPoorAirQuality(environment.airQualityRisk)
  ) {
    score += 8;
  }
  if (
    category === ProductCategory.Cleanser &&
    hasHardWaterConcern(environment)
  ) {
    score += 6;
  }
  if (
    (category === ProductCategory.Exfoliant ||
      category === ProductCategory.Treatment) &&
    (isDryHumidity(environment.humidityBand) ||
      hasHardWaterConcern(environment))
  ) {
    score -= 12;
  }
  return score;
}

function safetyConstraintForSignal(kind: EnvironmentSignalKind): string {
  const constraints: Record<EnvironmentSignalKind, string> = {
    [EnvironmentSignalKind.HighUv]: 'environment_high_uv',
    [EnvironmentSignalKind.LowHumidity]: 'environment_barrier_support',
    [EnvironmentSignalKind.ColdDry]: 'environment_barrier_support',
    [EnvironmentSignalKind.HotHumid]: 'environment_light_layers',
    [EnvironmentSignalKind.PollutionElevated]: 'environment_pollution_cleanse',
    [EnvironmentSignalKind.HardWaterReported]:
      'environment_hard_water_gentle_cleanse',
    [EnvironmentSignalKind.SeasonalTransitionDryer]:
      'environment_barrier_support',
    [EnvironmentSignalKind.SeasonalTransitionUvRising]: 'environment_high_uv',
  };
  return constraints[kind];
}

function emptyPolicy(): EnvironmentPolicyResult {
  return {
    signals: [],
    alerts: [],
    safetyConstraints: [],
    gapRecommendations: [],
    scoreCategory: () => 0,
  };
}

function dedupeSignals(signals: EnvironmentSignal[]): EnvironmentSignal[] {
  const seen = new Set<EnvironmentSignalKind>();
  return signals.filter((signal) => {
    if (seen.has(signal.kind)) return false;
    seen.add(signal.kind);
    return true;
  });
}
