import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckStatus } from './health.types';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  const healthService = {
    check: jest.fn(),
  };

  beforeEach(async () => {
    healthService.check.mockResolvedValue({
      checks: {
        api: { latencyMs: 0, status: HealthCheckStatus.Ok },
        database: { latencyMs: 3, status: HealthCheckStatus.Ok },
      },
      status: HealthCheckStatus.Ok,
      timestamp: '2026-05-21T08:00:00.000Z',
      uptimeSeconds: 10,
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns readiness status with safe component checks', async () => {
    const result = await controller.check();

    expect(result.status).toBe(HealthCheckStatus.Ok);
    expect(typeof result.timestamp).toBe('string');
    expect(result.checks.database.status).toBe(HealthCheckStatus.Ok);
    expect(healthService.check).toHaveBeenCalledTimes(1);
  });

  it('returns service unavailable when database readiness is down', async () => {
    healthService.check.mockResolvedValueOnce({
      checks: {
        api: { latencyMs: 0, status: HealthCheckStatus.Ok },
        database: { latencyMs: 4, status: HealthCheckStatus.Down },
      },
      status: HealthCheckStatus.Down,
      timestamp: '2026-05-21T08:00:00.000Z',
      uptimeSeconds: 10,
    });

    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
