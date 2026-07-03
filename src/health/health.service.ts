import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { nowDate, toIsoString } from '../common/utils/date';
import {
  HealthCheckResponse,
  HealthCheckStatus,
  type HealthCheckComponent,
} from './health.types';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  async check(): Promise<HealthCheckResponse> {
    const timestamp = toIsoString(nowDate());
    const [database, api] = await Promise.all([
      this.checkDatabase(),
      this.checkApi(),
    ]);
    const status =
      database.status === HealthCheckStatus.Down
        ? HealthCheckStatus.Down
        : HealthCheckStatus.Ok;

    return {
      checks: {
        api,
        database,
      },
      status,
      timestamp,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  /** Event-loop turnaround as a proxy for API responsiveness. */
  private async checkApi(): Promise<HealthCheckComponent> {
    const startedAt = process.hrtime.bigint();
    await new Promise((resolve) => setImmediate(resolve));
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    return {
      latencyMs: Math.max(Math.round(elapsedMs), 0),
      status: HealthCheckStatus.Ok,
    };
  }

  private async checkDatabase(): Promise<HealthCheckComponent> {
    const startedAt = Date.now();

    try {
      await this.dataSource.query('SELECT 1');
      return {
        latencyMs: Math.max(Date.now() - startedAt, 0),
        status: HealthCheckStatus.Ok,
      };
    } catch {
      return {
        latencyMs: Math.max(Date.now() - startedAt, 0),
        status: HealthCheckStatus.Down,
      };
    }
  }
}
