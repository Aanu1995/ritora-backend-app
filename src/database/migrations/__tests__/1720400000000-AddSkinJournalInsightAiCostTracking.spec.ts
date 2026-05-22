import { QueryRunner } from 'typeorm';
import { AddSkinJournalInsightAiCostTracking1720400000000 } from '../1720400000000-AddSkinJournalInsightAiCostTracking';

describe('AddSkinJournalInsightAiCostTracking1720400000000', () => {
  it('persists privacy-safe AI Insight token usage and estimated cost on generation runs', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new AddSkinJournalInsightAiCostTracking1720400000000().up(
      queryRunner,
    );

    const sql = queries.join('\n');
    expect(sql).toContain('ALTER TABLE "skin_journal_insight_generation_runs"');
    expect(sql).toContain('"ai_model" varchar(80)');
    expect(sql).toContain('"ai_input_tokens" integer');
    expect(sql).toContain('"ai_output_tokens" integer');
    expect(sql).toContain('"ai_total_tokens" integer');
    expect(sql).toContain('"ai_estimated_cost_usd" double precision');
    expect(sql).toContain('idx_skin_journal_insight_runs_completed_cost');
    expect(sql).not.toContain('headline');
    expect(sql).not.toContain('blocks');
    expect(sql).not.toContain('source_entry_ids');
  });
});
