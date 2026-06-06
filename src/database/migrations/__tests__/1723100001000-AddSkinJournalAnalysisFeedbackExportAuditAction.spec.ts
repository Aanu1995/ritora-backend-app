import { AddSkinJournalAnalysisFeedbackExportAuditAction1723100001000 } from '../1723100001000-AddSkinJournalAnalysisFeedbackExportAuditAction';

describe('AddSkinJournalAnalysisFeedbackExportAuditAction migration', () => {
  it('adds the audit enum value used for anonymous analysis feedback exports', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    };

    await new AddSkinJournalAnalysisFeedbackExportAuditAction1723100001000().up(
      queryRunner as never,
    );

    expect(queries.join('\n')).toContain(
      "ADD VALUE IF NOT EXISTS 'skin_journal_analysis_feedback_exported'",
    );
  });
});
