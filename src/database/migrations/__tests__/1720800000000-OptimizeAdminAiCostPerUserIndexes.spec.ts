import { QueryRunner } from 'typeorm';
import { OptimizeAdminAiCostPerUserIndexes1720800000000 } from '../1720800000000-OptimizeAdminAiCostPerUserIndexes';

describe('OptimizeAdminAiCostPerUserIndexes1720800000000', () => {
  it('rebuilds per-user AI cost indexes for filtered user rollups', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new OptimizeAdminAiCostPerUserIndexes1720800000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "idx_skin_journal_entries_ai_cost_user_started"',
    );
    expect(sql).toContain(
      'ON "skin_journal_entries" ("user_id", "analysis_started_at" DESC)',
    );
    expect(sql).toContain(
      'ON "skin_journal_insight_generation_runs" ("user_id", "completed_at" DESC)',
    );
    expect(sql).toContain(
      'ON "suggestion_instances" ("user_id", "generated_at" DESC)',
    );
    expect(sql).toContain(
      'ON "product_check_ai_review_metrics" ("user_id", "occurred_at" DESC)',
    );
    expect(sql).toContain(
      'ON "smart_pick_snapshots" ("user_id", "generated_at" DESC)',
    );
    expect(sql).toContain(
      'ON "smart_pick_generation_jobs" ("user_id", "updated_at" DESC)',
    );
    expect(sql).toContain('INCLUDE ("ai_estimated_cost_usd")');
  });
});
