import { AddAdminSearchPerformanceIndexes1719000000000 } from '../1719000000000-AddAdminSearchPerformanceIndexes';

describe('AddAdminSearchPerformanceIndexes1719000000000', () => {
  it('adds trigram-backed indexes for admin and product-user search paths', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    };

    await new AddAdminSearchPerformanceIndexes1719000000000().up(
      queryRunner as never,
    );

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
    expect(sql).toContain('idx_admin_accounts_search_email_trgm_active');
    expect(sql).toContain('idx_admin_accounts_search_name_trgm_active');
    expect(sql).toContain('idx_users_search_email_trgm');
    expect(sql).toContain('idx_users_search_first_name_trgm');
    expect(sql).toContain('idx_users_search_last_name_trgm');
  });
});
