import { AddAdminAuditAndOperationsIndexes1719200000000 } from '../1719200000000-AddAdminAuditAndOperationsIndexes';

describe('AddAdminAuditAndOperationsIndexes1719200000000', () => {
  it('adds indexes for audit history, user detail, and operations monitoring paths', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    };

    await new AddAdminAuditAndOperationsIndexes1719200000000().up(
      queryRunner as never,
    );

    const sql = queries.join('\n');
    expect(sql).toContain('idx_admin_audit_logs_created_at_id_desc');
    expect(sql).toContain('"created_at" DESC, "id" DESC');
    expect(sql).toContain('idx_admin_audit_logs_action_created_at_id_desc');
    expect(sql).toContain('idx_skin_journal_export_jobs_status_created');
    expect(sql).toContain('idx_user_data_access_logs_user_created');
  });
});
