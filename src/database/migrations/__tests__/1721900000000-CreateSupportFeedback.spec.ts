import { readFileSync } from 'fs';
import { join } from 'path';

describe('CreateSupportFeedback1721900000000', () => {
  it('creates shared support feedback tables with indexes, encryption-ready text, and admin audit actions', () => {
    const sql = readFileSync(
      join(__dirname, '../1721900000000-CreateSupportFeedback.ts'),
      'utf8',
    );

    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "support_feedback_items"',
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "support_feedback_notes"',
    );
    expect(sql).toContain('"description" text NOT NULL');
    expect(sql).toContain('"context" jsonb NOT NULL DEFAULT');
    expect(sql).toContain('idx_support_feedback_status_priority_updated');
    expect(sql).toContain('idx_support_feedback_assigned_status_updated');
    expect(sql).toContain('idx_support_feedback_user_status_updated');
    expect(sql).toContain('idx_support_feedback_notes_feedback_created');
    expect(sql).toContain('REFERENCES "users" ("id") ON DELETE SET NULL');
    expect(sql).toContain(
      'REFERENCES "admin_accounts" ("id") ON DELETE SET NULL',
    );
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'support_feedback_created'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'support_feedback_updated'");
    expect(sql).toContain(
      "ADD VALUE IF NOT EXISTS 'support_feedback_note_created'",
    );
  });
});
