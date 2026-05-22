import { readFileSync } from 'fs';
import { join } from 'path';

describe('CreateAdminUserNotes migration', () => {
  it('creates encrypted internal note storage with indexes and audit coverage', () => {
    const sql = readFileSync(
      join(__dirname, '../1719600000000-CreateAdminUserNotes.ts'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "admin_user_notes"');
    expect(sql).toContain('"body" text NOT NULL');
    expect(sql).toContain('idx_admin_user_notes_user_created');
    expect(sql).toContain('"user_id", "created_at" DESC, "id" DESC');
    expect(sql).toContain('idx_admin_user_notes_author_created');
    expect(sql).toContain('REFERENCES "users" ("id") ON DELETE CASCADE');
    expect(sql).toContain(
      'REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT',
    );
    expect(sql).toContain("typname = 'admin_audit_action'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'user_note_created'");
  });
});
