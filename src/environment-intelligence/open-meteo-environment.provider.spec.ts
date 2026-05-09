import { EnvironmentProviderName } from './environment-intelligence.constants';
import { OpenMeteoEnvironmentProvider } from './open-meteo-environment.provider';

describe('OpenMeteoEnvironmentProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('resolves the best city-level match without exposing precise location to callers', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 1,
            name: 'Stockholm',
            latitude: 59.33,
            longitude: 18.06,
            country_code: 'SE',
            country: 'Sweden',
            timezone: 'Europe/Stockholm',
            population: 975551,
          },
          {
            id: 2,
            name: 'Stockholm',
            latitude: 44.48,
            longitude: -92.26,
            country_code: 'US',
            country: 'United States',
            timezone: 'America/Chicago',
            population: 66,
          },
        ],
      }),
    );
    global.fetch = fetchMock;

    const provider = new OpenMeteoEnvironmentProvider();
    const result = await provider.resolveLocation({
      city: 'Stockholm',
      countryCode: 'SE',
    });

    expect(result).toEqual({
      provider: EnvironmentProviderName.OpenMeteo,
      providerLocationId: '1',
      label: 'Stockholm, Sweden',
      latitude: 59.33,
      longitude: 18.06,
      timeZone: 'Europe/Stockholm',
      confidence: 0.9,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/search?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns a normalized snapshot from forecast and air-quality payloads', async () => {
    const fetchMock = createFetchMock();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          current: {
            temperature_2m: 16,
            relative_humidity_2m: 38,
            weather_code: 0,
          },
          daily: { uv_index_max: [6.2] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          current: {
            european_aqi: 42,
            pm2_5: 8,
            pm10: 18,
            uv_index: 7,
            birch_pollen: 12,
          },
        }),
      );
    global.fetch = fetchMock;

    const provider = new OpenMeteoEnvironmentProvider();
    const result = await provider.fetchSnapshot({
      latitude: 59.33,
      longitude: 18.06,
      timeZone: 'Europe/Stockholm',
      targetDate: '2026-05-08',
      targetTime: '08:00',
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: EnvironmentProviderName.OpenMeteo,
        temperatureCelsius: 16,
        humidity: 38,
        uvIndex: 7,
        airQualityIndex: 42,
        pm25: 8,
        pm10: 18,
        pollenRisk: 'moderate',
        conditionLabel: 'Clear',
        seasonalTrend: {
          humidityDropping: true,
          uvRising: true,
        },
      }),
    );
  });

  it('degrades cleanly when provider payloads are malformed', async () => {
    const fetchMock = createFetchMock();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ latitude: '59.33' }] }))
      .mockResolvedValueOnce(
        jsonResponse({ current: { temperature_2m: 'hot' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ current: { european_aqi: 'poor' } }),
      );
    global.fetch = fetchMock;

    const provider = new OpenMeteoEnvironmentProvider();

    await expect(
      provider.resolveLocation({ city: 'Stockholm', countryCode: 'SE' }),
    ).resolves.toBeNull();
    await expect(
      provider.fetchSnapshot({
        latitude: 59.33,
        longitude: 18.06,
        timeZone: 'Europe/Stockholm',
        targetDate: '2026-05-08',
        targetTime: '08:00',
      }),
    ).resolves.toBeNull();
  });

  it('retries once after a transient provider failure', async () => {
    const fetchMock = createFetchMock();
    fetchMock
      .mockRejectedValueOnce(new Error('temporary provider outage'))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              name: 'Lagos',
              latitude: 6.45,
              longitude: 3.39,
              country_code: 'NG',
              country: 'Nigeria',
              timezone: 'Africa/Lagos',
            },
          ],
        }),
      );
    global.fetch = fetchMock;

    const provider = new OpenMeteoEnvironmentProvider();
    const result = await provider.resolveLocation({
      city: 'Lagos',
      countryCode: 'NG',
    });

    expect(result).toEqual(
      expect.objectContaining({
        label: 'Lagos, Nigeria',
        confidence: 0.9,
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once after a non-OK provider response', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValueOnce(statusResponse(503)).mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            name: 'London',
            latitude: 51.5,
            longitude: -0.12,
            country_code: 'GB',
            country: 'United Kingdom',
            timezone: 'Europe/London',
          },
        ],
      }),
    );
    global.fetch = fetchMock;

    const provider = new OpenMeteoEnvironmentProvider();
    const result = await provider.resolveLocation({
      city: 'London',
      countryCode: 'GB',
    });

    expect(result).toEqual(
      expect.objectContaining({
        label: 'London, United Kingdom',
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function createFetchMock(): jest.MockedFunction<typeof fetch> {
  return jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function statusResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as Response;
}
