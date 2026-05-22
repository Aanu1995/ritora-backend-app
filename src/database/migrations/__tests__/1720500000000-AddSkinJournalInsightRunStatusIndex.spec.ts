import { QueryRunner } from 'typeorm';
import { AddSkinJournalInsightRunStatusIndex1720500000000 } from '../1720500000000-AddSkinJournalInsightRunStatusIndex';

describe('AddSkinJournalInsightRunStatusIndex1720500000000', () => {
  it('indexes insight generation run status for admin health success-rate counts', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new AddSkinJournalInsightRunStatusIndex1720500000000().up(
      queryRunner,
    );

    const sql = queries.join('\n');
    expect(sql).toContain('idx_skin_journal_insight_runs_status');
    expect(sql).toContain(
      'ON "skin_journal_insight_generation_runs" ("status")',
    );
  });
});
