import { OptimizeSupportFeedbackPublicUse1722000000000 } from '../1722000000000-OptimizeSupportFeedbackPublicUse';

describe('OptimizeSupportFeedbackPublicUse1722000000000', () => {
  it('adds the user-created and support-search indexes used by public support', async () => {
    const migration = new OptimizeSupportFeedbackPublicUse1722000000000();
    const query = jest.fn();

    await migration.up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
    expect(sql).toContain('idx_support_feedback_user_created');
    expect(sql).toContain(
      'ON "support_feedback_items" ("user_id", "created_at" DESC)',
    );
    expect(sql).toContain('idx_support_feedback_title_trgm');
    expect(sql).toContain('USING gin ("title" gin_trgm_ops)');
    expect(sql).toContain('idx_support_feedback_reporter_email_trgm');
    expect(sql).toContain('USING gin ("reporter_email" gin_trgm_ops)');
  });

  it('drops only the support optimization indexes on rollback', async () => {
    const migration = new OptimizeSupportFeedbackPublicUse1722000000000();
    const query = jest.fn();

    await migration.down({ query } as never);

    expect(query).toHaveBeenCalledWith(
      'DROP INDEX IF EXISTS "idx_support_feedback_reporter_email_trgm"',
    );
    expect(query).toHaveBeenCalledWith(
      'DROP INDEX IF EXISTS "idx_support_feedback_title_trgm"',
    );
    expect(query).toHaveBeenCalledWith(
      'DROP INDEX IF EXISTS "idx_support_feedback_user_created"',
    );
  });
});
