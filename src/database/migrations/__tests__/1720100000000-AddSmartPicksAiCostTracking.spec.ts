import { QueryRunner } from 'typeorm';
import { AddSmartPicksAiCostTracking1720100000000 } from '../1720100000000-AddSmartPicksAiCostTracking';

describe('AddSmartPicksAiCostTracking1720100000000', () => {
  it('persists Smart Picks token usage and estimated cost on generation tables', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new AddSmartPicksAiCostTracking1720100000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain('ALTER TABLE "smart_pick_snapshots"');
    expect(sql).toContain('ALTER TABLE "smart_pick_generation_jobs"');
    expect(sql).toContain('"ai_input_tokens" integer');
    expect(sql).toContain('"ai_output_tokens" integer');
    expect(sql).toContain('"ai_estimated_cost_usd" double precision');
    expect(sql).toContain('idx_smart_pick_snapshots_generated_cost');
    expect(sql).toContain('idx_smart_pick_generation_jobs_updated_cost');
  });
});
