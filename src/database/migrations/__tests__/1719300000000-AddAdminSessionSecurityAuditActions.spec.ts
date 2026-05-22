import { AddAdminSessionSecurityAuditActions1719300000000 } from '../1719300000000-AddAdminSessionSecurityAuditActions';

describe('AddAdminSessionSecurityAuditActions1719300000000', () => {
  it('adds admin session audit actions and a descending session lookup index', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    };

    await new AddAdminSessionSecurityAuditActions1719300000000().up(
      queryRunner as never,
    );

    const sql = queries.join('\n');
    expect(sql).toContain("typname = 'admin_audit_action'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'admin_logged_out'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'admin_session_revoked'");
    expect(sql).toContain("ADD VALUE IF NOT EXISTS 'admin_sessions_revoked'");
    expect(sql).toContain('idx_admin_sessions_admin_last_used_at');
    expect(sql).toContain('"admin_id", "last_used_at" DESC');
  });
});
