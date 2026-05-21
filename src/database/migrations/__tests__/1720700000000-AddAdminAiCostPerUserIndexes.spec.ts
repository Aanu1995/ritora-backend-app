import { QueryRunner } from 'typeorm';
import { AddAdminAiCostPerUserIndexes1720700000000 } from '../1720700000000-AddAdminAiCostPerUserIndexes';

describe('AddAdminAiCostPerUserIndexes1720700000000', () => {
  it('adds cost-period user indexes for per-user admin AI cost rollups', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new AddAdminAiCostPerUserIndexes1720700000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain('idx_skin_journal_entries_ai_cost_user_started');
    expect(sql).toContain('idx_skin_journal_insight_runs_user_completed_cost');
    expect(sql).toContain('idx_suggestion_instances_ai_cost_user_generated');
    expect(sql).toContain('idx_smart_pick_snapshots_user_generated_cost');
    expect(sql).toContain('idx_smart_pick_generation_jobs_user_updated_cost');
  });
});
