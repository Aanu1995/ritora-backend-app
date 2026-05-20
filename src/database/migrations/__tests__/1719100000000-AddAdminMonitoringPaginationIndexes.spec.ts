import { AddAdminMonitoringPaginationIndexes1719100000000 } from '../1719100000000-AddAdminMonitoringPaginationIndexes';

describe('AddAdminMonitoringPaginationIndexes1719100000000', () => {
  it('adds covering indexes for admin dashboard pagination paths', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    };

    await new AddAdminMonitoringPaginationIndexes1719100000000().up(
      queryRunner as never,
    );

    const sql = queries.join('\n');
    expect(sql).toContain('idx_users_monitoring_created_at_id_desc');
    expect(sql).toContain('ON "users" ("created_at" DESC, "id" DESC)');
    expect(sql).toContain('WHERE "account_restricted_at" IS NOT NULL');
    expect(sql).toContain('WHERE "account_restricted_at" IS NULL');
    expect(sql).toContain('idx_admin_accounts_active_created_at_id_asc');
    expect(sql).toContain('WHERE "deleted_at" IS NULL');
  });
});
