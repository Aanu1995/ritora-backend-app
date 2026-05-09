export const EnvironmentProviderName = {
  OpenMeteo: 'open_meteo',
  ProfileOnly: 'profile_only',
  TimeZoneOnly: 'timezone_only',
} as const;

export type EnvironmentProviderName =
  (typeof EnvironmentProviderName)[keyof typeof EnvironmentProviderName];

export const EnvironmentStatus = {
  Available: 'available',
  Degraded: 'degraded',
  Unavailable: 'unavailable',
} as const;

export type EnvironmentStatus =
  (typeof EnvironmentStatus)[keyof typeof EnvironmentStatus];

export const EnvironmentConfidence = {
  Provider: 'provider',
  Estimated: 'estimated',
  Degraded: 'degraded',
  None: 'none',
} as const;

export type EnvironmentConfidence =
  (typeof EnvironmentConfidence)[keyof typeof EnvironmentConfidence];

export const EnvironmentSeason = {
  Spring: 'spring',
  Summer: 'summer',
  Autumn: 'autumn',
  Winter: 'winter',
} as const;

export type EnvironmentSeason =
  (typeof EnvironmentSeason)[keyof typeof EnvironmentSeason];

export const EnvironmentTemperatureBand = {
  Freezing: 'freezing',
  Cold: 'cold',
  Mild: 'mild',
  Warm: 'warm',
  Hot: 'hot',
} as const;

export type EnvironmentTemperatureBand =
  (typeof EnvironmentTemperatureBand)[keyof typeof EnvironmentTemperatureBand];

export const EnvironmentHumidityBand = {
  VeryDry: 'very_dry',
  Dry: 'dry',
  Balanced: 'balanced',
  Humid: 'humid',
  VeryHumid: 'very_humid',
} as const;

export type EnvironmentHumidityBand =
  (typeof EnvironmentHumidityBand)[keyof typeof EnvironmentHumidityBand];

export const EnvironmentUvRisk = {
  Low: 'low',
  Moderate: 'moderate',
  High: 'high',
  VeryHigh: 'very_high',
  Extreme: 'extreme',
  Unknown: 'unknown',
} as const;

export type EnvironmentUvRisk =
  (typeof EnvironmentUvRisk)[keyof typeof EnvironmentUvRisk];

export const EnvironmentAirQualityRisk = {
  Good: 'good',
  Fair: 'fair',
  Moderate: 'moderate',
  Poor: 'poor',
  VeryPoor: 'very_poor',
  Unknown: 'unknown',
} as const;

export type EnvironmentAirQualityRisk =
  (typeof EnvironmentAirQualityRisk)[keyof typeof EnvironmentAirQualityRisk];

export const EnvironmentWaterHardness = {
  Unknown: 'unknown',
  Soft: 'soft',
  Moderate: 'moderate',
  Hard: 'hard',
} as const;

export type EnvironmentWaterHardness =
  (typeof EnvironmentWaterHardness)[keyof typeof EnvironmentWaterHardness];

export const ENVIRONMENT_WATER_HARDNESS_VALUES = Object.values(
  EnvironmentWaterHardness,
);

export const EnvironmentWaterSensitivity = {
  None: 'none',
  Suspected: 'suspected',
  Confirmed: 'confirmed',
} as const;

export type EnvironmentWaterSensitivity =
  (typeof EnvironmentWaterSensitivity)[keyof typeof EnvironmentWaterSensitivity];

export const ENVIRONMENT_WATER_SENSITIVITY_VALUES = Object.values(
  EnvironmentWaterSensitivity,
);

export const EnvironmentSignalKind = {
  HighUv: 'high_uv',
  LowHumidity: 'low_humidity',
  ColdDry: 'cold_dry',
  HotHumid: 'hot_humid',
  PollutionElevated: 'pollution_elevated',
  HardWaterReported: 'hard_water_reported',
  SeasonalTransitionDryer: 'seasonal_transition_drier',
  SeasonalTransitionUvRising: 'seasonal_transition_uv_rising',
} as const;

export type EnvironmentSignalKind =
  (typeof EnvironmentSignalKind)[keyof typeof EnvironmentSignalKind];

export const ENVIRONMENT_CONTEXT_CACHE_TTL_MINUTES = 60;
export const ENVIRONMENT_LOCATION_CACHE_TTL_DAYS = 30;
export const ENVIRONMENT_SNAPSHOT_RETENTION_DAYS = 90;
export const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com';
export const OPEN_METEO_GEOCODING_BASE_URL =
  'https://geocoding-api.open-meteo.com';
export const OPEN_METEO_FETCH_TIMEOUT_MS = 6_000;
