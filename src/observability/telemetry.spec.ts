import { isTelemetryEnabled, readServiceName } from './telemetry';

describe('telemetry config', () => {
  it('starts only when explicitly enabled', () => {
    expect(isTelemetryEnabled({ OTEL_ENABLED: 'true' })).toBe(true);
    expect(isTelemetryEnabled({ OTEL_ENABLED: 'false' })).toBe(false);
    expect(isTelemetryEnabled({})).toBe(false);
  });

  it('uses a stable service name fallback', () => {
    expect(readServiceName({ OTEL_SERVICE_NAME: 'ritora-api' })).toBe(
      'ritora-api',
    );
    expect(readServiceName({ OTEL_SERVICE_NAME: ' ' })).toBe(
      'ritora-backend-api',
    );
  });
});
