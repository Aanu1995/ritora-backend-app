import { readFileSync } from 'fs';
import { join } from 'path';

describe('AddAdminMfa migration', () => {
  it('adds encrypted MFA columns and audit enum values defensively', () => {
    const sql = readFileSync(
      join(__dirname, '../1719500000000-AddAdminMfa.ts'),
      'utf8',
    );

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "mfa_totp_secret"');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "mfa_recovery_code_hashes"',
    );
    expect(sql).toContain("typname = 'admin_audit_action'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'admin_mfa_enabled'");
    expect(sql).toContain(
      "ADD VALUE IF NOT EXISTS 'admin_mfa_recovery_code_used'",
    );
    expect(sql).toContain('idx_admin_accounts_mfa_enabled_at');
  });
});
