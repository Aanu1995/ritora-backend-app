import { readFileSync } from 'fs';
import { join } from 'path';

describe('CreateAdminNotifications migration', () => {
  it('creates per-admin in-app notifications with unread and ordering indexes', () => {
    const sql = readFileSync(
      join(__dirname, '../1721800000000-CreateAdminNotifications.ts'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "admin_notifications"');
    expect(sql).toContain('"body" text NOT NULL');
    expect(sql).toContain('"metadata" jsonb NOT NULL DEFAULT');
    expect(sql).toContain("\"severity\" IN ('info', 'warning', 'critical')");
    expect(sql).toContain(
      'REFERENCES "admin_accounts" ("id") ON DELETE CASCADE',
    );
    expect(sql).toContain('idx_admin_notifications_admin_unread_created');
    expect(sql).toContain('WHERE "read_at" IS NULL');
  });
});
