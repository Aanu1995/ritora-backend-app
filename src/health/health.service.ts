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
    const database = await this.checkDatabase();
    const status =
      database.status === HealthCheckStatus.Down
        ? HealthCheckStatus.Down
        : HealthCheckStatus.Ok;

    return {
      checks: {
        api: {
          latencyMs: 0,
          status: HealthCheckStatus.Ok,
        },
        database,
      },
      status,
      timestamp,
      uptimeSeconds: Math.floor(process.uptime()),
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
