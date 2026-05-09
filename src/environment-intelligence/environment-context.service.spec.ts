import { ObjectLiteral, Repository } from 'typeorm';
import { UserConsent } from '../users/entities/user-consent.entity';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { EnvironmentLocationCache } from './entities/environment-location-cache.entity';
import { EnvironmentSnapshot } from './entities/environment-snapshot.entity';
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
} from './environment-intelligence.constants';
import type { EnvironmentContextSummary } from './environment-intelligence.types';
import type { EnvironmentProvider } from './environment-provider.interface';
import { EnvironmentContextService } from './environment-context.service';

describe('EnvironmentContextService', () => {
  const locationRepo = repo<EnvironmentLocationCache>();
  const snapshotRepo = repo<EnvironmentSnapshot>();
  const consentRepo = repo<UserConsent>();
  const provider = providerMock();
  const dataAccessLog = {
    recordDataAccess: jest.fn(),
  } as unknown as jest.Mocked<UserDataAccessLogService>;
  const service = new EnvironmentContextService(
    locationRepo,
    snapshotRepo,
    consentRepo,
    dataAccessLog,
    provider,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    locationRepo.findOne.mockResolvedValue(null);
    snapshotRepo.findOne.mockResolvedValue(null);
    locationRepo.create.mockImplementation(
      (value) => value as EnvironmentLocationCache,
    );
    snapshotRepo.create.mockImplementation(
      (value) => value as EnvironmentSnapshot,
    );
    locationRepo.save.mockImplementation(
      async (value) => value as EnvironmentLocationCache,
    );
    snapshotRepo.save.mockImplementation(
      async (value) => value as EnvironmentSnapshot,
    );
    consentRepo.findOne.mockResolvedValue(activeLocationConsent());
    provider.resolveLocation.mockResolvedValue({
      provider: EnvironmentProviderName.OpenMeteo,
      providerLocationId: '2673730',
      label: 'Stockholm, Sweden',
      latitude: 59.33,
      longitude: 18.06,
      timeZone: 'Europe/Stockholm',
      confidence: 0.91,
    });
    provider.fetchSnapshot.mockResolvedValue({
      provider: EnvironmentProviderName.OpenMeteo,
      fetchedAt: '2026-05-08T10:00:00.000Z',
      temperatureCelsius: 16,
      humidity: 41,
      uvIndex: 6,
      airQualityIndex: 32,
      pm25: 8,
      pm10: 18,
      pollenRisk: 'moderate',
      conditionLabel: 'Clear',
      seasonalTrend: {
        humidityDropping: true,
        uvRising: true,
      },
    });
  });

  it('uses saved city only with location consent and stores a minimized encrypted snapshot', async () => {
    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:00',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:00:00.000Z'),
    });

    expect(provider.resolveLocation).toHaveBeenCalledWith({
      city: 'Stockholm',
      countryCode: 'SE',
    });
    expect(provider.fetchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 59.33,
        longitude: 18.06,
        targetDate: '2026-05-08',
        targetTime: '08:00',
      }),
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        status: EnvironmentStatus.Available,
        provider: EnvironmentProviderName.OpenMeteo,
        locationPersonalized: true,
        uvRisk: EnvironmentUvRisk.High,
        waterHardness: EnvironmentWaterHardness.Hard,
        waterSensitivity: EnvironmentWaterSensitivity.Suspected,
      }),
    );
    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        expires_at: new Date('2026-05-08T07:00:00.000Z'),
        summary: expect.not.objectContaining({
          city: expect.any(String),
          countryCode: expect.any(String),
          latitude: expect.any(Number),
          longitude: expect.any(Number),
        }),
      }),
    );
    expect(dataAccessLog.recordDataAccess).toHaveBeenCalledWith(
      'user-1',
      [UserConsentType.LocationProcessing],
      UserDataAccessPurpose.RecommendationAnalysis,
    );
  });

  it('falls back without provider calls when location consent is missing', async () => {
    consentRepo.findOne.mockResolvedValue(null);

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:00',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:00:00.000Z'),
    });

    expect(provider.resolveLocation).not.toHaveBeenCalled();
    expect(provider.fetchSnapshot).not.toHaveBeenCalled();
    expect(result.summary).toEqual(
      expect.objectContaining({
        status: EnvironmentStatus.Degraded,
        locationPersonalized: false,
        waterHardness: EnvironmentWaterHardness.Hard,
      }),
    );
    expect(dataAccessLog.recordDataAccess).not.toHaveBeenCalled();
  });

  it('returns degraded profile context when the provider fails', async () => {
    provider.fetchSnapshot.mockResolvedValue(null);

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:00',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:00:00.000Z'),
    });

    expect(result.summary.status).toBe(EnvironmentStatus.Degraded);
    expect(result.summary.locationPersonalized).toBe(true);
    expect(result.summary.provider).toBe(EnvironmentProviderName.OpenMeteo);
  });

  it('reuses unexpired snapshots within the current time bucket without provider refetching', async () => {
    const cachedLocation = locationCache();
    const cachedSnapshot = {
      id: 'snapshot-1',
      summary: environmentSummary(),
    } as EnvironmentSnapshot;
    locationRepo.findOne.mockResolvedValue(cachedLocation);
    snapshotRepo.findOne.mockResolvedValue(cachedSnapshot);

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:17',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:17:00.000Z'),
    });

    expect(snapshotRepo.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        user_id: 'user-1',
        target_date: '2026-05-08',
        target_time_bucket: '06:00',
        location_cache_id: 'location-1',
      }),
    });
    expect(provider.resolveLocation).not.toHaveBeenCalled();
    expect(provider.fetchSnapshot).not.toHaveBeenCalled();
    expect(snapshotRepo.save).not.toHaveBeenCalled();
    expect(result.snapshot).toBe(cachedSnapshot);
  });

  it('reuses a valid snapshot before refreshing a stale cached location', async () => {
    const cachedLocation = locationCache({
      refreshed_at: new Date('2025-01-08T05:00:00.000Z'),
    });
    const cachedSnapshot = {
      id: 'snapshot-1',
      summary: environmentSummary(),
    } as EnvironmentSnapshot;
    locationRepo.findOne.mockResolvedValue(cachedLocation);
    snapshotRepo.findOne.mockResolvedValue(cachedSnapshot);

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:17',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:17:00.000Z'),
    });

    expect(provider.resolveLocation).not.toHaveBeenCalled();
    expect(provider.fetchSnapshot).not.toHaveBeenCalled();
    expect(snapshotRepo.save).not.toHaveBeenCalled();
    expect(result.snapshot).toBe(cachedSnapshot);
  });

  it('reuses a fresh degraded location-personalized snapshot after provider resolution previously failed', async () => {
    const cachedSnapshot = {
      id: 'snapshot-1',
      summary: environmentSummary({
        status: EnvironmentStatus.Degraded,
        provider: EnvironmentProviderName.OpenMeteo,
        locationPersonalized: true,
        confidence: EnvironmentConfidence.Degraded,
        temperatureCelsius: null,
        temperatureBand: null,
        humidity: null,
        humidityBand: null,
        uvIndex: null,
        airQualityIndex: null,
      }),
    } as EnvironmentSnapshot;
    snapshotRepo.findOne.mockResolvedValue(cachedSnapshot);

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:17',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:04:00.000Z'),
    });

    expect(provider.resolveLocation).not.toHaveBeenCalled();
    expect(provider.fetchSnapshot).not.toHaveBeenCalled();
    expect(snapshotRepo.save).not.toHaveBeenCalled();
    expect(result.snapshot).toBe(cachedSnapshot);
  });

  it('refreshes an old degraded location-personalized snapshot instead of hiding climate for the full weather cache window', async () => {
    locationRepo.findOne.mockResolvedValue(locationCache());
    snapshotRepo.findOne.mockResolvedValue({
      id: 'snapshot-1',
      summary: environmentSummary({
        status: EnvironmentStatus.Degraded,
        provider: EnvironmentProviderName.OpenMeteo,
        generatedAt: '2026-05-08T06:00:00.000Z',
        locationPersonalized: true,
        confidence: EnvironmentConfidence.Degraded,
        temperatureCelsius: null,
        temperatureBand: null,
        humidity: null,
        humidityBand: null,
        uvIndex: null,
        airQualityIndex: null,
      }),
    } as EnvironmentSnapshot);

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:17',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:08:00.000Z'),
    });

    expect(provider.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        location_cache_id: 'location-1',
        summary: expect.objectContaining({
          status: EnvironmentStatus.Available,
          temperatureCelsius: 16,
        }),
      }),
    );
    expect(result.summary.status).toBe(EnvironmentStatus.Available);
  });

  it('refreshes an old weather-only provider snapshot so air quality can recover', async () => {
    locationRepo.findOne.mockResolvedValue(locationCache());
    snapshotRepo.findOne.mockResolvedValue({
      id: 'snapshot-1',
      summary: environmentSummary({
        generatedAt: '2026-05-08T06:00:00.000Z',
        airQualityIndex: null,
        airQualityRisk: EnvironmentAirQualityRisk.Unknown,
        pm25: null,
        pm10: null,
        pollenRisk: null,
      }),
    } as EnvironmentSnapshot);

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:17',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:08:00.000Z'),
    });

    expect(provider.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        location_cache_id: 'location-1',
        summary: expect.objectContaining({
          airQualityIndex: 32,
          pm25: 8,
          pm10: 18,
          pollenRisk: 'moderate',
        }),
      }),
    );
    expect(result.summary.airQualityIndex).toBe(32);
  });

  it('recovers when another request creates the same location cache first', async () => {
    locationRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(locationCache());
    locationRepo.save.mockRejectedValueOnce({ code: '23505' });

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:17',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:17:00.000Z'),
    });

    expect(provider.fetchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 59.33,
        longitude: 18.06,
      }),
    );
    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        location_cache_id: 'location-1',
      }),
    );
    expect(result.summary.locationPersonalized).toBe(true);
  });

  it('does not reuse profile-only snapshots after location consent is granted', async () => {
    locationRepo.save.mockImplementationOnce(
      async (value) =>
        ({
          ...value,
          id: 'location-1',
        }) as EnvironmentLocationCache,
    );
    snapshotRepo.findOne.mockResolvedValue({
      id: 'snapshot-1',
      summary: environmentSummary({
        status: EnvironmentStatus.Degraded,
        provider: EnvironmentProviderName.ProfileOnly,
        locationPersonalized: false,
        confidence: EnvironmentConfidence.Degraded,
      }),
    } as EnvironmentSnapshot);

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:17',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:17:00.000Z'),
    });

    expect(provider.resolveLocation).toHaveBeenCalledTimes(1);
    expect(provider.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        location_cache_id: 'location-1',
        summary: expect.objectContaining({
          locationPersonalized: true,
        }),
      }),
    );
    expect(result.summary.locationPersonalized).toBe(true);
  });

  it('does not reuse cached snapshots after water or climate profile changes', async () => {
    locationRepo.findOne.mockResolvedValue(locationCache());
    snapshotRepo.findOne.mockResolvedValue({
      id: 'snapshot-1',
      summary: environmentSummary({
        waterHardness: EnvironmentWaterHardness.Soft,
      }),
    } as EnvironmentSnapshot);

    const result = await service.buildContext({
      userId: 'user-1',
      profile: skinProfile(),
      targetDate: '2026-05-08',
      targetTime: '08:17',
      timeZone: 'Europe/Stockholm',
      now: new Date('2026-05-08T06:17:00.000Z'),
    });

    expect(provider.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        target_time_bucket: '06:00',
        summary: expect.objectContaining({
          waterHardness: EnvironmentWaterHardness.Hard,
        }),
      }),
    );
    expect(result.summary.waterHardness).toBe(EnvironmentWaterHardness.Hard);
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function providerMock(): jest.Mocked<EnvironmentProvider> {
  return {
    resolveLocation: jest.fn(),
    fetchSnapshot: jest.fn(),
  };
}

function skinProfile(): SkinProfile {
  return {
    user_id: 'user-1',
    country_code: 'SE',
    city: 'Stockholm',
    lifestyle_context: {
      climate_sensitivities: ['dry_air', 'pollution'],
      water_hardness: EnvironmentWaterHardness.Hard,
      water_sensitivity: EnvironmentWaterSensitivity.Suspected,
      water_reaction_notes: 'Feels tight after showering.',
    },
  } as SkinProfile;
}

function locationCache(
  overrides: Partial<EnvironmentLocationCache> = {},
): EnvironmentLocationCache {
  return {
    id: 'location-1',
    user_id: 'user-1',
    provider: EnvironmentProviderName.OpenMeteo,
    location_key: 'location-key',
    coordinates: {
      latitude: 59.33,
      longitude: 18.06,
    },
    time_zone: 'Europe/Stockholm',
    refreshed_at: new Date('2026-05-08T05:00:00.000Z'),
    ...overrides,
  } as EnvironmentLocationCache;
}

function environmentSummary(
  overrides: Partial<EnvironmentContextSummary> = {},
): EnvironmentContextSummary {
  return {
    status: EnvironmentStatus.Available,
    provider: EnvironmentProviderName.OpenMeteo,
    generatedAt: '2026-05-08T06:00:00.000Z',
    locationPersonalized: true,
    season: EnvironmentSeason.Spring,
    temperatureCelsius: 16,
    temperatureBand: EnvironmentTemperatureBand.Mild,
    humidity: 41,
    humidityBand: EnvironmentHumidityBand.Balanced,
    uvIndex: 6,
    uvRisk: EnvironmentUvRisk.High,
    airQualityIndex: 32,
    airQualityRisk: EnvironmentAirQualityRisk.Fair,
    pm25: 8,
    pm10: 18,
    pollenRisk: 'moderate',
    conditionLabel: 'Clear',
    waterHardness: EnvironmentWaterHardness.Hard,
    waterSensitivity: EnvironmentWaterSensitivity.Suspected,
    climateSensitivities: ['dry_air', 'pollution'],
    transitionSignals: [],
    confidence: EnvironmentConfidence.Provider,
    stale: false,
    sourceIds: [],
    ...overrides,
  };
}

function activeLocationConsent(): UserConsent {
  return {
    consent_type: UserConsentType.LocationProcessing,
    granted: true,
    revoked_at: null,
  } as UserConsent;
}
