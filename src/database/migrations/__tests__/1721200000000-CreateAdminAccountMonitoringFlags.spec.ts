import { readFileSync } from 'fs';
import { join } from 'path';

describe('CreateAdminAccountMonitoringFlags migration', () => {
  it('creates encrypted account monitoring flags with active dedupe indexes and audit actions', () => {
    const sql = readFileSync(
      join(__dirname, '../1721200000000-CreateAdminAccountMonitoringFlags.ts'),
      'utf8',
    );

    expect(sql).toContain('CREATE TYPE "admin_account_monitoring_signal_type"');
    expect(sql).toContain('CREATE TYPE "admin_account_monitoring_status"');
    expect(sql).toContain('CREATE TYPE "admin_account_monitoring_severity"');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "admin_account_monitoring_flags"',
    );
    expect(sql).toContain('"latest_signal" text');
    expect(sql).toContain('"internal_note" text');
    expect(sql).toContain('"resolution_note" text');
    expect(sql).toContain('idx_admin_account_monitoring_status_review');
    expect(sql).toContain('idx_admin_account_monitoring_user_status');
    expect(sql).toContain('idx_admin_account_monitoring_assigned_status');
    expect(sql).toContain('idx_admin_account_monitoring_active_unique');
    expect(sql).toContain(`WHERE "status" IN ('open', 'watching')`);
    expect(sql).toContain('REFERENCES "users" ("id") ON DELETE CASCADE');
    expect(sql).toContain(
      "ADD VALUE IF NOT EXISTS 'account_monitoring_flag_created'",
    );
    expect(sql).toContain(
      "ADD VALUE IF NOT EXISTS 'account_monitoring_flag_updated'",
    );
    expect(sql).toContain(
      "ADD VALUE IF NOT EXISTS 'account_monitoring_flag_resolved'",
    );
  });
});
