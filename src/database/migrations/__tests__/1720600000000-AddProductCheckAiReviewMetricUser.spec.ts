import { QueryRunner } from 'typeorm';
import { AddProductCheckAiReviewMetricUser1720600000000 } from '../1720600000000-AddProductCheckAiReviewMetricUser';

describe('AddProductCheckAiReviewMetricUser1720600000000', () => {
  it('adds a nullable user id for Quick Check cost attribution without storing product content', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new AddProductCheckAiReviewMetricUser1720600000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "user_id" varchar(26)');
    expect(sql).toContain('fk_product_check_ai_review_metrics_user');
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).toContain('idx_product_check_ai_review_metrics_user_cost');
    expect(sql).not.toContain('product_name');
    expect(sql).not.toContain('ingredient');
    expect(sql).not.toContain('image');
  });
});
