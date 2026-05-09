import { Injectable, Logger } from '@nestjs/common';
import {
  EnvironmentProviderName,
  OPEN_METEO_BASE_URL,
  OPEN_METEO_FETCH_TIMEOUT_MS,
  OPEN_METEO_GEOCODING_BASE_URL,
} from './environment-intelligence.constants';
import type {
  EnvironmentLocationLookup,
  EnvironmentProviderLocation,
  EnvironmentProviderSnapshot,
} from './environment-intelligence.types';
import type { EnvironmentProvider } from './environment-provider.interface';

type OpenMeteoGeocodingResponse = {
  results?: OpenMeteoGeocodingResult[];
};

type OpenMeteoGeocodingResult = {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  country_code?: string;
  country?: string;
  timezone?: string;
  population?: number;
};

type OpenMeteoForecastResponse = {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
  };
  daily?: {
    uv_index_max?: Array<number | null>;
  };
};

type OpenMeteoAirQualityResponse = {
  current?: {
    european_aqi?: number;
    pm2_5?: number;
    pm10?: number;
    uv_index?: number;
    alder_pollen?: number;
    birch_pollen?: number;
    grass_pollen?: number;
    mugwort_pollen?: number;
    olive_pollen?: number;
    ragweed_pollen?: number;
  };
};

@Injectable()
export class OpenMeteoEnvironmentProvider implements EnvironmentProvider {
  private readonly logger = new Logger(OpenMeteoEnvironmentProvider.name);

  async resolveLocation(
    lookup: EnvironmentLocationLookup,
  ): Promise<EnvironmentProviderLocation | null> {
    const params = new URLSearchParams({
      name: lookup.city,
      count: '5',
      language: 'en',
      format: 'json',
      countryCode: lookup.countryCode,
    });
    const payload = await fetchJson(
      `${OPEN_METEO_GEOCODING_BASE_URL}/v1/search?${params.toString()}`,
      this.logger,
    );
    const response = parseGeocodingResponse(payload);
    const match = pickBestLocation(response?.results ?? [], lookup.countryCode);
    if (
      !match ||
      !isFiniteNumber(match.latitude) ||
      !isFiniteNumber(match.longitude)
    ) {
      return null;
    }

    return {
      provider: EnvironmentProviderName.OpenMeteo,
      providerLocationId: String(
        match.id ?? `${match.latitude},${match.longitude}`,
      ),
      label: [match.name, match.country].filter(Boolean).join(', '),
      latitude: match.latitude,
      longitude: match.longitude,
      timeZone: match.timezone ?? null,
      confidence: confidenceForLocation(match, lookup.countryCode),
    };
  }

  async fetchSnapshot(input: {
    latitude: number;
    longitude: number;
    timeZone: string;
    targetDate: string;
    targetTime: string;
  }): Promise<EnvironmentProviderSnapshot | null> {
    const [forecast, airQuality] = await Promise.all([
      this.fetchForecast(input),
      this.fetchAirQuality(input),
    ]);
    if (!forecast && !airQuality) return null;

    const uvIndex =
      airQuality?.current?.uv_index ??
      forecast?.daily?.uv_index_max?.find((value) => value !== null) ??
      null;
    return {
      provider: EnvironmentProviderName.OpenMeteo,
      fetchedAt: new Date().toISOString(),
      temperatureCelsius: forecast?.current?.temperature_2m ?? null,
      humidity: forecast?.current?.relative_humidity_2m ?? null,
      uvIndex,
      airQualityIndex: airQuality?.current?.european_aqi ?? null,
      pm25: airQuality?.current?.pm2_5 ?? null,
      pm10: airQuality?.current?.pm10 ?? null,
      pollenRisk: classifyPollenRisk(airQuality?.current ?? null),
      conditionLabel: weatherCodeLabel(forecast?.current?.weather_code ?? null),
      seasonalTrend: {
        humidityDropping: (forecast?.current?.relative_humidity_2m ?? 100) < 40,
        uvRising: (uvIndex ?? 0) >= 6,
      },
    };
  }

  private async fetchForecast(input: {
    latitude: number;
    longitude: number;
    timeZone: string;
  }): Promise<OpenMeteoForecastResponse | null> {
    const params = new URLSearchParams({
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      timezone: input.timeZone,
      current: 'temperature_2m,relative_humidity_2m,weather_code',
      daily: 'uv_index_max',
      forecast_days: '1',
    });
    const payload = await fetchJson(
      `${OPEN_METEO_BASE_URL}/v1/forecast?${params.toString()}`,
      this.logger,
    );
    return parseForecastResponse(payload);
  }

  private async fetchAirQuality(input: {
    latitude: number;
    longitude: number;
    timeZone: string;
  }): Promise<OpenMeteoAirQualityResponse | null> {
    const params = new URLSearchParams({
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      timezone: input.timeZone,
      current:
        'european_aqi,pm2_5,pm10,uv_index,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen',
      forecast_days: '1',
    });
    const payload = await fetchJson(
      `${OPEN_METEO_BASE_URL}/v1/air-quality?${params.toString()}`,
      this.logger,
    );
    return parseAirQualityResponse(payload);
  }
}

async function fetchJson(url: string, logger: Logger): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(OPEN_METEO_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        if (attempt === 1) {
          logger.warn(
            `Environment provider request failed with status ${response.status}`,
          );
        }
        continue;
      }
      const payload: unknown = await response.json();
      return payload;
    } catch (error) {
      if (attempt === 1) {
        logger.warn(
          `Environment provider request failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }
  return null;
}

function parseGeocodingResponse(
  payload: unknown,
): OpenMeteoGeocodingResponse | null {
  if (!isRecord(payload)) return null;
  const rawResults = payload.results;
  if (!Array.isArray(rawResults)) return { results: [] };
  return {
    results: rawResults
      .map(parseGeocodingResult)
      .filter((result): result is OpenMeteoGeocodingResult => result !== null),
  };
}

function parseGeocodingResult(
  payload: unknown,
): OpenMeteoGeocodingResult | null {
  if (!isRecord(payload)) return null;
  return {
    id: numberValue(payload.id),
    name: stringValue(payload.name),
    latitude: numberValue(payload.latitude),
    longitude: numberValue(payload.longitude),
    country_code: stringValue(payload.country_code),
    country: stringValue(payload.country),
    timezone: stringValue(payload.timezone),
    population: numberValue(payload.population),
  };
}

function parseForecastResponse(
  payload: unknown,
): OpenMeteoForecastResponse | null {
  if (!isRecord(payload)) return null;
  const current = isRecord(payload.current)
    ? {
        temperature_2m: numberValue(payload.current.temperature_2m),
        relative_humidity_2m: numberValue(payload.current.relative_humidity_2m),
        weather_code: numberValue(payload.current.weather_code),
      }
    : undefined;
  const daily = isRecord(payload.daily)
    ? {
        uv_index_max: nullableNumberArray(payload.daily.uv_index_max),
      }
    : undefined;
  if (!hasObjectValue(current) && !hasObjectValue(daily)) return null;
  return { current, daily };
}

function parseAirQualityResponse(
  payload: unknown,
): OpenMeteoAirQualityResponse | null {
  if (!isRecord(payload)) return null;
  const current = isRecord(payload.current)
    ? {
        european_aqi: numberValue(payload.current.european_aqi),
        pm2_5: numberValue(payload.current.pm2_5),
        pm10: numberValue(payload.current.pm10),
        uv_index: numberValue(payload.current.uv_index),
        alder_pollen: numberValue(payload.current.alder_pollen),
        birch_pollen: numberValue(payload.current.birch_pollen),
        grass_pollen: numberValue(payload.current.grass_pollen),
        mugwort_pollen: numberValue(payload.current.mugwort_pollen),
        olive_pollen: numberValue(payload.current.olive_pollen),
        ragweed_pollen: numberValue(payload.current.ragweed_pollen),
      }
    : undefined;
  if (!hasObjectValue(current)) return null;
  return { current };
}

function pickBestLocation(
  results: OpenMeteoGeocodingResult[],
  countryCode: string,
): OpenMeteoGeocodingResult | null {
  const sameCountry = results.filter(
    (result) =>
      result.country_code?.toUpperCase() === countryCode.toUpperCase(),
  );
  return (
    [...sameCountry, ...results].sort(
      (first, second) => (second.population ?? 0) - (first.population ?? 0),
    )[0] ?? null
  );
}

function confidenceForLocation(
  result: OpenMeteoGeocodingResult,
  countryCode: string,
): number {
  const countryMatch =
    result.country_code?.toUpperCase() === countryCode.toUpperCase();
  return countryMatch ? 0.9 : 0.65;
}

function classifyPollenRisk(
  current: OpenMeteoAirQualityResponse['current'] | null,
): string | null {
  if (!current) return null;
  const values = [
    current.alder_pollen,
    current.birch_pollen,
    current.grass_pollen,
    current.mugwort_pollen,
    current.olive_pollen,
    current.ragweed_pollen,
  ].filter(isFiniteNumber);
  const max = Math.max(0, ...values);
  if (max >= 50) return 'high';
  if (max >= 10) return 'moderate';
  if (max > 0) return 'low';
  return null;
}

function weatherCodeLabel(code: number | null): string | null {
  if (code === null) return null;
  if (code === 0) return 'Clear';
  if ([1, 2, 3].includes(code)) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  if (code >= 51 && code <= 67) return 'Rainy';
  if (code >= 71 && code <= 77) return 'Snowy';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Stormy';
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function nullableNumberArray(value: unknown): Array<number | null> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      if (item === null) return null;
      return isFiniteNumber(item) ? item : undefined;
    })
    .filter((item): item is number | null => item !== undefined);
}

function hasObjectValue<T extends object>(value: T | undefined): boolean {
  if (!value) return false;
  return Object.values(value).some((item) => {
    if (Array.isArray(item)) return item.length > 0;
    return item !== undefined;
  });
}
