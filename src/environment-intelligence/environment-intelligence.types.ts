import type { SuggestionEvidenceSourceId } from '../suggestions/suggestions.constants';
import type { ProductCategory } from '../shelf/shelf.types';
import type {
  EnvironmentAirQualityRisk,
  EnvironmentConfidence,
  EnvironmentHumidityBand,
  EnvironmentProviderName,
  EnvironmentSeason,
  EnvironmentSignalKind,
  EnvironmentStatus,
  EnvironmentTemperatureBand,
  EnvironmentUvRisk,
  EnvironmentWaterHardness,
  EnvironmentWaterSensitivity,
} from './environment-intelligence.constants';

export interface EnvironmentContextSummary {
  status: EnvironmentStatus;
  provider: EnvironmentProviderName;
  generatedAt: string;
  locationPersonalized: boolean;
  season: EnvironmentSeason;
  temperatureCelsius: number | null;
  temperatureBand: EnvironmentTemperatureBand | null;
  humidity: number | null;
  humidityBand: EnvironmentHumidityBand | null;
  uvIndex: number | null;
  uvRisk: EnvironmentUvRisk;
  airQualityIndex: number | null;
  airQualityRisk: EnvironmentAirQualityRisk;
  pm25: number | null;
  pm10: number | null;
  pollenRisk: string | null;
  conditionLabel: string | null;
  waterHardness: EnvironmentWaterHardness;
  waterSensitivity: EnvironmentWaterSensitivity;
  climateSensitivities: string[];
  transitionSignals: EnvironmentSignalKind[];
  confidence: EnvironmentConfidence;
  stale: boolean;
  sourceIds: SuggestionEvidenceSourceId[];
}

export interface EnvironmentSignal {
  kind: EnvironmentSignalKind;
  severity: 'info' | 'warning';
  message: string;
  sourceIds: SuggestionEvidenceSourceId[];
}

export interface EnvironmentAlert {
  kind: EnvironmentSignalKind;
  title: string;
  message: string;
  sourceIds: SuggestionEvidenceSourceId[];
}

export interface EnvironmentPolicyResult {
  signals: EnvironmentSignal[];
  alerts: EnvironmentAlert[];
  safetyConstraints: string[];
  gapRecommendations: {
    ingredientOrCategory: string;
    reason: string;
    goalAlignment: string | null;
    sourceIds: SuggestionEvidenceSourceId[];
  }[];
  scoreCategory: (category: ProductCategory) => number;
}

export interface EnvironmentLocationLookup {
  city: string;
  countryCode: string;
}

export interface EnvironmentProviderLocation {
  provider: EnvironmentProviderName;
  providerLocationId: string;
  label: string;
  latitude: number;
  longitude: number;
  timeZone: string | null;
  confidence: number;
}

export interface EnvironmentProviderSnapshot {
  provider: EnvironmentProviderName;
  fetchedAt: string;
  temperatureCelsius: number | null;
  humidity: number | null;
  uvIndex: number | null;
  airQualityIndex: number | null;
  pm25: number | null;
  pm10: number | null;
  pollenRisk: string | null;
  conditionLabel: string | null;
  seasonalTrend: {
    humidityDropping: boolean;
    uvRising: boolean;
  };
}
