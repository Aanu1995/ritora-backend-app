import { CreateSkinJournalAnalysisFeedback1723100000000 } from '../1723100000000-CreateSkinJournalAnalysisFeedback';

describe('CreateSkinJournalAnalysisFeedback migration', () => {
  it('creates an anonymous feedback table for analysis usefulness telemetry', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    };

    await new CreateSkinJournalAnalysisFeedback1723100000000().up(
      queryRunner as never,
    );

    const sql = queries.join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "skin_journal_analysis_feedback"',
    );
    expect(sql).not.toContain('"user_id"');
    expect(sql).not.toContain('"entry_id"');
    expect(sql).not.toContain('REFERENCES "users"');
    expect(sql).not.toContain('REFERENCES "skin_journal_entries"');
    expect(sql).not.toContain('UQ_skin_journal_analysis_feedback_user_entry');
    expect(sql).not.toContain(
      'IDX_skin_journal_analysis_feedback_user_created',
    );
    expect(sql).toContain('IDX_skin_journal_analysis_feedback_vote_created');
    expect(sql).toContain('IDX_skin_journal_analysis_feedback_reason_created');
    expect(sql).toContain('"reason" varchar(40)');
    expect(sql).toContain('"note" text');
  });
});
