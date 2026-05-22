import { DataSource } from 'typeorm';
import { HealthCheckStatus } from './health.types';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports API and database readiness without exposing database details', async () => {
    const query = jest.fn(async () => [{ ok: 1 }]);
    const service = new HealthService({ query } as unknown as DataSource);

    const result = await service.check();

    expect(result.status).toBe(HealthCheckStatus.Ok);
    expect(result.checks.api.status).toBe(HealthCheckStatus.Ok);
    expect(result.checks.database.status).toBe(HealthCheckStatus.Ok);
    expect(result.checks.database.latencyMs).toEqual(expect.any(Number));
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain('DATABASE');
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('marks readiness down when the database cannot be reached', async () => {
    const query = jest.fn(async () => {
      throw new Error('connection refused');
    });
    const service = new HealthService({ query } as unknown as DataSource);

    const result = await service.check();

    expect(result.status).toBe(HealthCheckStatus.Down);
    expect(result.checks.api.status).toBe(HealthCheckStatus.Ok);
    expect(result.checks.database.status).toBe(HealthCheckStatus.Down);
    expect(result.checks.database.latencyMs).toEqual(expect.any(Number));
    expect(JSON.stringify(result)).not.toContain('connection refused');
  });
});
