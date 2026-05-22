import { QueryRunner } from 'typeorm';
import { CreateProductCheckAiReviewMetrics1720300000000 } from '../1720300000000-CreateProductCheckAiReviewMetrics';

describe('CreateProductCheckAiReviewMetrics1720300000000', () => {
  it('creates privacy-safe Quick Check AI cost telemetry', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new CreateProductCheckAiReviewMetrics1720300000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "product_check_ai_review_metrics"',
    );
    expect(sql).toContain('"ai_estimated_cost_usd" double precision');
    expect(sql).toContain('idx_product_check_ai_review_metrics_cost');
    expect(sql).toContain('idx_product_check_ai_review_metrics_status_time');
    expect(sql).not.toContain('user_id');
    expect(sql).not.toContain('product_name');
    expect(sql).not.toContain('ingredients');
  });
});
