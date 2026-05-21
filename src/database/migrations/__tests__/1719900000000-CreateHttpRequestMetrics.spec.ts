import { QueryRunner } from 'typeorm';
import { CreateHttpRequestMetrics1719900000000 } from '../1719900000000-CreateHttpRequestMetrics';

describe('CreateHttpRequestMetrics1719900000000', () => {
  it('creates privacy-safe endpoint telemetry without raw request fields', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new CreateHttpRequestMetrics1719900000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "http_request_metrics"');
    expect(sql).toContain('"route" varchar(180) NOT NULL');
    expect(sql).toContain('"duration_ms" integer NOT NULL');
    expect(sql).toContain('idx_http_request_metrics_occurred_route');
    expect(sql).not.toContain('ip_address');
    expect(sql).not.toContain('user_agent');
    expect(sql).not.toContain('request_body');
  });
});
