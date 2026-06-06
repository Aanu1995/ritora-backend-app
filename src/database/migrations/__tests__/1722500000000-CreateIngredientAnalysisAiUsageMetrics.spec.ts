import { QueryRunner } from 'typeorm';
import { CreateIngredientAnalysisAiUsageMetrics1722500000000 } from '../1722500000000-CreateIngredientAnalysisAiUsageMetrics';

describe('CreateIngredientAnalysisAiUsageMetrics1722500000000', () => {
  it('creates privacy-safe ingredient analysis AI usage telemetry with per-user cost indexes', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new CreateIngredientAnalysisAiUsageMetrics1722500000000().up(
      queryRunner,
    );

    const sql = queries.join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "ingredient_analysis_ai_usage_metrics"',
    );
    expect(sql).toContain('"user_id" varchar(26)');
    expect(sql).toContain('"source" varchar(60) NOT NULL');
    expect(sql).toContain('"operation" varchar(40) NOT NULL');
    expect(sql).toContain('"ai_estimated_cost_usd" double precision');
    expect(sql).toContain('idx_ingredient_analysis_ai_usage_metrics_user_cost');
    expect(sql).toContain('idx_ingredient_analysis_ai_usage_metrics_cost_time');
    expect(sql).toContain('fk_ingredient_analysis_ai_usage_metrics_user');
    expect(sql).not.toContain('ingredient_name');
    expect(sql).not.toContain('ingredients');
    expect(sql).not.toContain('prompt');
    expect(sql).not.toContain('response');
  });
});
