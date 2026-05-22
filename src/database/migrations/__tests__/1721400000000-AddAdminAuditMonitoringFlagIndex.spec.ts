import { AddAdminAuditMonitoringFlagIndex1721400000000 } from '../1721400000000-AddAdminAuditMonitoringFlagIndex';

describe('AddAdminAuditMonitoringFlagIndex1721400000000', () => {
  const migration = new AddAdminAuditMonitoringFlagIndex1721400000000();

  it('adds an expression index for monitoring flag audit lookups', async () => {
    const queryRunner = { query: jest.fn() };

    await migration.up(queryRunner as never);

    const sql = queryRunner.query.mock.calls.map(([query]) => query).join('\n');
    expect(sql).toContain('idx_admin_audit_logs_monitoring_flag_id');
    expect(sql).toContain("metadata ->> 'monitoringFlagId'");
    expect(sql).toContain("WHERE metadata ? 'monitoringFlagId'");
  });

  it('drops the monitoring flag audit lookup index', async () => {
    const queryRunner = { query: jest.fn() };

    await migration.down(queryRunner as never);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('DROP INDEX IF EXISTS'),
    );
  });
});
