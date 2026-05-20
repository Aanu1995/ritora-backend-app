import { AddUserAccountRestrictions1718800000000 } from '../1718800000000-AddUserAccountRestrictions';

describe('AddUserAccountRestrictions1718800000000', () => {
  it('self-heals missing admin audit enum drift before adding restriction audit actions', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    };

    await new AddUserAccountRestrictions1718800000000().up(
      queryRunner as never,
    );

    const sql = queries.join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "account_restricted_at"');
    expect(sql).toContain('idx_auth_sessions_user_last_used_at');
    expect(sql).toContain("typname = 'admin_audit_action'");
    expect(sql).toContain('CREATE TYPE "admin_audit_action" AS ENUM');
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'admin_invitation_resent'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'user_restricted'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'user_unrestricted'");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "admin_audit_logs"');
    expect(sql).toContain('FK_admin_audit_logs_actor_admin');
    expect(sql).toContain('FK_admin_audit_logs_target_admin');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "target_user_id"');
    expect(sql).toContain('fk_admin_audit_logs_target_user_id');
  });
});
