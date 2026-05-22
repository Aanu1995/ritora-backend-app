import {
  EnvironmentAirQualityRisk,
  EnvironmentHumidityBand,
  EnvironmentSeason,
  EnvironmentTemperatureBand,
  EnvironmentUvRisk,
} from './environment-intelligence.constants';

export function classifyTemperature(
  temperatureCelsius: number | null,
): EnvironmentTemperatureBand | null {
  if (temperatureCelsius === null) return null;
  if (temperatureCelsius <= 0) return EnvironmentTemperatureBand.Freezing;
  if (temperatureCelsius < 10) return EnvironmentTemperatureBand.Cold;
  if (temperatureCelsius < 22) return EnvironmentTemperatureBand.Mild;
  if (temperatureCelsius < 30) return EnvironmentTemperatureBand.Warm;
  return EnvironmentTemperatureBand.Hot;
}

export function classifyHumidity(
  humidity: number | null,
): EnvironmentHumidityBand | null {
  if (humidity === null) return null;
  if (humidity < 30) return EnvironmentHumidityBand.VeryDry;
  if (humidity < 45) return EnvironmentHumidityBand.Dry;
  if (humidity <= 65) return EnvironmentHumidityBand.Balanced;
  if (humidity <= 80) return EnvironmentHumidityBand.Humid;
  return EnvironmentHumidityBand.VeryHumid;
}

export function classifyUv(uvIndex: number | null): EnvironmentUvRisk {
  if (uvIndex === null) return EnvironmentUvRisk.Unknown;
  if (uvIndex < 3) return EnvironmentUvRisk.Low;
  if (uvIndex < 6) return EnvironmentUvRisk.Moderate;
  if (uvIndex < 8) return EnvironmentUvRisk.High;
  if (uvIndex < 11) return EnvironmentUvRisk.VeryHigh;
  return EnvironmentUvRisk.Extreme;
}

export function classifyAirQuality(
  airQualityIndex: number | null,
): EnvironmentAirQualityRisk {
  if (airQualityIndex === null) return EnvironmentAirQualityRisk.Unknown;
  if (airQualityIndex <= 20) return EnvironmentAirQualityRisk.Good;
  if (airQualityIndex <= 40) return EnvironmentAirQualityRisk.Fair;
  if (airQualityIndex <= 60) return EnvironmentAirQualityRisk.Moderate;
  if (airQualityIndex <= 100) return EnvironmentAirQualityRisk.Poor;
  return EnvironmentAirQualityRisk.VeryPoor;
}

export function deriveSeason(
  date: string,
  latitude: number | null,
): EnvironmentSeason {
  const month = Number(date.slice(5, 7));
  const northernSeason = seasonForNorthernHemisphere(month);
  if (latitude !== null && latitude < 0) {
    return invertSeason(northernSeason);
  }
  return northernSeason;
}

function seasonForNorthernHemisphere(month: number): EnvironmentSeason {
  if (month >= 3 && month <= 5) return EnvironmentSeason.Spring;
  if (month >= 6 && month <= 8) return EnvironmentSeason.Summer;
  if (month >= 9 && month <= 11) return EnvironmentSeason.Autumn;
  return EnvironmentSeason.Winter;
}

function invertSeason(season: EnvironmentSeason): EnvironmentSeason {
  if (season === EnvironmentSeason.Spring) return EnvironmentSeason.Autumn;
  if (season === EnvironmentSeason.Summer) return EnvironmentSeason.Winter;
  if (season === EnvironmentSeason.Autumn) return EnvironmentSeason.Spring;
  return EnvironmentSeason.Summer;
}
