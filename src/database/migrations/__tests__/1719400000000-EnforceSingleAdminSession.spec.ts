import { EnforceSingleAdminSession1719400000000 } from '../1719400000000-EnforceSingleAdminSession';

describe('EnforceSingleAdminSession1719400000000', () => {
  it('revokes duplicate active sessions and enforces one active admin session', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    };

    await new EnforceSingleAdminSession1719400000000().up(queryRunner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('UPDATE "admin_sessions" AS stale');
    expect(sql).toContain('DISTINCT ON ("admin_id")');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_sessions_single_active_session"',
    );
    expect(sql).toContain('WHERE "revoked_at" IS NULL');
  });
});
