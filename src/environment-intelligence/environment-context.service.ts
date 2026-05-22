import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { isPostgresUniqueConstraintError } from '../common/utils/database-errors';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import {
  ENVIRONMENT_CONTEXT_CACHE_TTL_MINUTES,
  ENVIRONMENT_DEGRADED_CONTEXT_CACHE_TTL_MINUTES,
  ENVIRONMENT_LOCATION_CACHE_TTL_DAYS,
  ENVIRONMENT_PARTIAL_CONTEXT_CACHE_TTL_MINUTES,
  ENVIRONMENT_WATER_HARDNESS_VALUES,
  ENVIRONMENT_WATER_SENSITIVITY_VALUES,
  EnvironmentConfidence,
  EnvironmentProviderName,
  EnvironmentSignalKind,
  EnvironmentStatus,
  EnvironmentWaterHardness,
  EnvironmentWaterSensitivity,
} from './environment-intelligence.constants';
import type {
  EnvironmentContextSummary,
  EnvironmentProviderSnapshot,
} from './environment-intelligence.types';
import {
  classifyAirQuality,
  classifyHumidity,
  classifyTemperature,
  classifyUv,
  deriveSeason,
} from './environment-classifiers';
import {
  ENVIRONMENT_PROVIDER,
  EnvironmentProvider,
} from './environment-provider.interface';
import { EnvironmentLocationCache } from './entities/environment-location-cache.entity';
import { EnvironmentSnapshot } from './entities/environment-snapshot.entity';
import { SuggestionEvidenceSourceId } from '../suggestions/suggestions.constants';

export interface EnvironmentBuildInput {
  userId: string;
  profile: SkinProfile | null;
  targetDate: string;
  targetTime: string;
  timeZone: string;
  now?: Date;
}

export interface EnvironmentBuildResult {
  summary: EnvironmentContextSummary;
  snapshot: EnvironmentSnapshot | null;
}

@Injectable()
export class EnvironmentContextService {
  constructor(
    @InjectRepository(EnvironmentLocationCache)
    private readonly locationRepo: Repository<EnvironmentLocationCache>,
    @InjectRepository(EnvironmentSnapshot)
    private readonly snapshotRepo: Repository<EnvironmentSnapshot>,
    @InjectRepository(UserConsent)
    private readonly consentRepo: Repository<UserConsent>,
    private readonly dataAccessLog: UserDataAccessLogService,
    @Inject(ENVIRONMENT_PROVIDER)
    private readonly provider: EnvironmentProvider,
  ) {}

  async buildContext(
    input: EnvironmentBuildInput,
  ): Promise<EnvironmentBuildResult> {
    const now = input.now ?? new Date();
    const targetTimeBucket = normalizeTimeBucket(input.targetTime);
    const canUseLocation = await this.canUseLocation(input);
    const cachedLocation = canUseLocation
      ? await this.findCachedLocation(input)
      : null;
    const cached = await this.snapshotRepo.findOne({
      where: {
        user_id: input.userId,
        target_date: input.targetDate,
        target_time_bucket: targetTimeBucket,
        location_cache_id: cachedLocation?.id ?? IsNull(),
        expires_at: MoreThan(now),
      },
    });
    if (
      cached?.summary &&
      cachedSummaryMatchesRequest(cached.summary, input, canUseLocation, now)
    ) {
      return { summary: cached.summary, snapshot: cached };
    }

    if (!canUseLocation) {
      return this.saveSnapshot(input, fallbackSummary(input, now, false));
    }

    const location = await this.resolveLocation(input, now, cachedLocation);
    if (!location?.coordinates) {
      return this.saveSnapshot(input, fallbackSummary(input, now, true));
    }

    await this.dataAccessLog.recordDataAccess(
      input.userId,
      [UserConsentType.LocationProcessing],
      UserDataAccessPurpose.RecommendationAnalysis,
    );

    const providerSnapshot = await this.provider.fetchSnapshot({
      latitude: location.coordinates.latitude,
      longitude: location.coordinates.longitude,
      timeZone: location.time_zone ?? input.timeZone,
      targetDate: input.targetDate,
      targetTime: input.targetTime,
    });
    const summary = providerSnapshot
      ? providerSummary(input, now, providerSnapshot, location)
      : fallbackSummary(input, now, true);
    const result = await this.saveSnapshot(input, summary, location.id);
    return result;
  }

  private async canUseLocation(input: EnvironmentBuildInput): Promise<boolean> {
    if (!input.profile?.country_code?.trim() || !input.profile.city?.trim()) {
      return false;
    }
    const consent = await this.consentRepo.findOne({
      where: {
        user_id: input.userId,
        consent_type: UserConsentType.LocationProcessing,
        granted: true,
        revoked_at: IsNull(),
      },
    });
    return Boolean(consent);
  }

  private async findCachedLocation(
    input: EnvironmentBuildInput,
  ): Promise<EnvironmentLocationCache | null> {
    const locationKey = locationCacheKeyForInput(input);
    if (!locationKey) return null;

    return this.locationRepo.findOne({
      where: {
        user_id: input.userId,
        provider: EnvironmentProviderName.OpenMeteo,
        location_key: locationKey,
      },
    });
  }

  private async resolveLocation(
    input: EnvironmentBuildInput,
    now: Date,
    cached: EnvironmentLocationCache | null,
  ): Promise<EnvironmentLocationCache | null> {
    const city = input.profile?.city?.trim();
    const countryCode = input.profile?.country_code?.trim().toUpperCase();
    if (!city || !countryCode) return null;

    const locationKey = locationCacheKey(city, countryCode);
    if (cached && !isLocationCacheStale(cached, now) && cached.coordinates) {
      return cached;
    }

    const resolved = await this.provider.resolveLocation({ city, countryCode });
    if (!resolved) return cached?.coordinates ? cached : null;
    const row = this.locationRepo.create({
      ...(cached ?? {}),
      user_id: input.userId,
      provider: EnvironmentProviderName.OpenMeteo,
      location_key: locationKey,
      location_snapshot: {
        city,
        countryCode,
        label: resolved.label,
      },
      coordinates: {
        latitude: resolved.latitude,
        longitude: resolved.longitude,
      },
      provider_metadata: {
        providerLocationId: resolved.providerLocationId,
        confidence: resolved.confidence,
      },
      time_zone: resolved.timeZone,
      refreshed_at: now,
    });
    try {
      return await this.locationRepo.save(row);
    } catch (error) {
      if (!isPostgresUniqueConstraintError(error)) {
        throw error;
      }
      return this.locationRepo.findOne({
        where: {
          user_id: input.userId,
          provider: EnvironmentProviderName.OpenMeteo,
          location_key: locationKey,
        },
      });
    }
  }

  private async saveSnapshot(
    input: EnvironmentBuildInput,
    summary: EnvironmentContextSummary,
    locationCacheId: string | null = null,
  ): Promise<EnvironmentBuildResult> {
    const expiresAt = buildSnapshotExpiry(input.now ?? new Date(), summary);
    const snapshot = await this.snapshotRepo.save(
      this.snapshotRepo.create({
        user_id: input.userId,
        location_cache_id: locationCacheId,
        target_date: input.targetDate,
        target_time_bucket: normalizeTimeBucket(input.targetTime),
        summary,
        expires_at: expiresAt,
      }),
    );
    return { summary, snapshot };
  }
}

function locationCacheKeyForInput(input: EnvironmentBuildInput): string | null {
  const city = input.profile?.city?.trim();
  const countryCode = input.profile?.country_code?.trim().toUpperCase();
  return city && countryCode ? locationCacheKey(city, countryCode) : null;
}

function providerSummary(
  input: EnvironmentBuildInput,
  now: Date,
  snapshot: EnvironmentProviderSnapshot,
  location: EnvironmentLocationCache,
): EnvironmentContextSummary {
  const latitude = location.coordinates?.latitude ?? null;
  const transitionSignals: EnvironmentSignalKind[] = [];
  if (snapshot.seasonalTrend.humidityDropping) {
    transitionSignals.push(EnvironmentSignalKind.SeasonalTransitionDryer);
  }
  if (snapshot.seasonalTrend.uvRising) {
    transitionSignals.push(EnvironmentSignalKind.SeasonalTransitionUvRising);
  }
  return {
    status: EnvironmentStatus.Available,
    provider: snapshot.provider,
    generatedAt: now.toISOString(),
    locationPersonalized: true,
    season: deriveSeason(input.targetDate, latitude),
    temperatureCelsius: snapshot.temperatureCelsius,
    temperatureBand: classifyTemperature(snapshot.temperatureCelsius),
    humidity: snapshot.humidity,
    humidityBand: classifyHumidity(snapshot.humidity),
    uvIndex: snapshot.uvIndex,
    uvRisk: classifyUv(snapshot.uvIndex),
    airQualityIndex: snapshot.airQualityIndex,
    airQualityRisk: classifyAirQuality(snapshot.airQualityIndex),
    pm25: snapshot.pm25,
    pm10: snapshot.pm10,
    pollenRisk: snapshot.pollenRisk,
    conditionLabel: snapshot.conditionLabel,
    ...waterAndClimate(input.profile),
    transitionSignals,
    confidence: EnvironmentConfidence.Provider,
    stale: false,
    sourceIds: [
      SuggestionEvidenceSourceId.OpenMeteoWeather,
      SuggestionEvidenceSourceId.OpenMeteoAirQuality,
      SuggestionEvidenceSourceId.OpenMeteoSeasonalForecast,
    ],
  };
}

function fallbackSummary(
  input: EnvironmentBuildInput,
  now: Date,
  locationPersonalized: boolean,
): EnvironmentContextSummary {
  return {
    status: EnvironmentStatus.Degraded,
    provider: locationPersonalized
      ? EnvironmentProviderName.OpenMeteo
      : EnvironmentProviderName.ProfileOnly,
    generatedAt: now.toISOString(),
    locationPersonalized,
    season: deriveSeason(input.targetDate, null),
    temperatureCelsius: null,
    temperatureBand: null,
    humidity: null,
    humidityBand: null,
    uvIndex: null,
    uvRisk: classifyUv(null),
    airQualityIndex: null,
    airQualityRisk: classifyAirQuality(null),
    pm25: null,
    pm10: null,
    pollenRisk: null,
    conditionLabel: null,
    ...waterAndClimate(input.profile),
    transitionSignals: [],
    confidence: EnvironmentConfidence.Degraded,
    stale: false,
    sourceIds: [],
  };
}

function waterAndClimate(
  profile: SkinProfile | null,
): Pick<
  EnvironmentContextSummary,
  'waterHardness' | 'waterSensitivity' | 'climateSensitivities'
> {
  const lifestyle = profile?.lifestyle_context ?? {};
  return {
    waterHardness: normalizeWaterHardness(lifestyle.water_hardness),
    waterSensitivity: normalizeWaterSensitivity(lifestyle.water_sensitivity),
    climateSensitivities: lifestyle.climate_sensitivities ?? [],
  };
}

function normalizeWaterHardness(
  value: string | undefined,
): EnvironmentWaterHardness {
  return ENVIRONMENT_WATER_HARDNESS_VALUES.includes(
    value as EnvironmentWaterHardness,
  )
    ? (value as EnvironmentWaterHardness)
    : EnvironmentWaterHardness.Unknown;
}

function normalizeWaterSensitivity(
  value: string | undefined,
): EnvironmentWaterSensitivity {
  return ENVIRONMENT_WATER_SENSITIVITY_VALUES.includes(
    value as EnvironmentWaterSensitivity,
  )
    ? (value as EnvironmentWaterSensitivity)
    : EnvironmentWaterSensitivity.None;
}

function locationCacheKey(city: string, countryCode: string): string {
  return createHash('sha256')
    .update(`${countryCode.trim().toUpperCase()}:${city.trim().toLowerCase()}`)
    .digest('hex');
}

function normalizeTimeBucket(targetTime: string): string {
  const hour = Number(targetTime.slice(0, 2));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return '00:00';
  }
  const bucketHour = Math.floor(hour / 3) * 3;
  return `${String(bucketHour).padStart(2, '0')}:00`;
}

function isLocationCacheStale(
  cached: EnvironmentLocationCache,
  now: Date,
): boolean {
  const refreshedAt = cached.refreshed_at?.getTime() ?? 0;
  const ageMs = now.getTime() - refreshedAt;
  return ageMs > ENVIRONMENT_LOCATION_CACHE_TTL_DAYS * 86_400_000;
}

function cachedSummaryMatchesRequest(
  summary: EnvironmentContextSummary,
  input: EnvironmentBuildInput,
  canUseLocation: boolean,
  now: Date,
): boolean {
  const current = waterAndClimate(input.profile);
  return (
    isReusableSummary(summary, canUseLocation, now) &&
    summary.locationPersonalized === canUseLocation &&
    summary.waterHardness === current.waterHardness &&
    summary.waterSensitivity === current.waterSensitivity &&
    haveSameStringSet(
      summary.climateSensitivities,
      current.climateSensitivities,
    )
  );
}

function buildSnapshotExpiry(
  now: Date,
  summary: EnvironmentContextSummary,
): Date {
  const ttlMinutes =
    summary.status === EnvironmentStatus.Degraded &&
    summary.locationPersonalized
      ? ENVIRONMENT_DEGRADED_CONTEXT_CACHE_TTL_MINUTES
      : hasMissingProviderAirQuality(summary)
        ? ENVIRONMENT_PARTIAL_CONTEXT_CACHE_TTL_MINUTES
        : ENVIRONMENT_CONTEXT_CACHE_TTL_MINUTES;
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

function isReusableSummary(
  summary: EnvironmentContextSummary,
  canUseLocation: boolean,
  now: Date,
): boolean {
  if (
    summary.status !== EnvironmentStatus.Degraded ||
    !summary.locationPersonalized ||
    !canUseLocation
  ) {
    return isReusablePartialSummary(summary, now);
  }

  const generatedAtMs = Date.parse(summary.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return false;
  }

  return (
    now.getTime() - generatedAtMs <
    ENVIRONMENT_DEGRADED_CONTEXT_CACHE_TTL_MINUTES * 60_000
  );
}

function isReusablePartialSummary(
  summary: EnvironmentContextSummary,
  now: Date,
): boolean {
  if (!hasMissingProviderAirQuality(summary)) {
    return true;
  }

  const generatedAtMs = Date.parse(summary.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return false;
  }

  return (
    now.getTime() - generatedAtMs <
    ENVIRONMENT_PARTIAL_CONTEXT_CACHE_TTL_MINUTES * 60_000
  );
}

function hasMissingProviderAirQuality(
  summary: EnvironmentContextSummary,
): boolean {
  return (
    summary.status === EnvironmentStatus.Available &&
    summary.locationPersonalized &&
    summary.airQualityIndex === null &&
    summary.pm25 === null &&
    summary.pm10 === null &&
    summary.pollenRisk === null
  );
}

function haveSameStringSet(first: string[], second: string[]): boolean {
  if (first.length !== second.length) return false;
  const firstSet = new Set(first);
  return second.every((value) => firstSet.has(value));
}
