import { AddSkinJournalAnalysisFeedbackMarker1723100002000 } from '../1723100002000-AddSkinJournalAnalysisFeedbackMarker';

describe('AddSkinJournalAnalysisFeedbackMarker1723100002000', () => {
  it('adds typed analysis feedback marker columns to entries', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => queries.push(sql)),
    };

    await new AddSkinJournalAnalysisFeedbackMarker1723100002000().up(
      queryRunner as never,
    );

    const sql = queries.join('\n');
    expect(sql).toContain('"analysis_feedback_submitted" boolean');
    expect(sql).toContain('"analysis_feedback_submitted_at" timestamptz');
    expect(sql).toContain(
      '"analysis_feedback_interpretation_version" varchar(20)',
    );
    expect(sql).toContain('IDX_skin_journal_entries_feedback_submitted');
  });
});
