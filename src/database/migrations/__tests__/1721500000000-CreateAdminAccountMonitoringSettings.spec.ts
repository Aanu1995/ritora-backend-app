import { CreateAdminAccountMonitoringSettings1721500000000 } from '../1721500000000-CreateAdminAccountMonitoringSettings';

describe('CreateAdminAccountMonitoringSettings1721500000000', () => {
  const migration = new CreateAdminAccountMonitoringSettings1721500000000();

  it('creates configurable account monitoring thresholds with safe defaults', async () => {
    const queryRunner = { query: jest.fn() };

    await migration.up(queryRunner as never);

    const sql = queryRunner.query.mock.calls.map(([query]) => query).join('\n');
    expect(sql).toContain('admin_account_monitoring_settings');
    expect(sql).toContain('unknownAuthFailures24hWarning');
    expect(sql).toContain('aiGenerations24hWarning');
    expect(sql).toContain('account_monitoring_settings_updated');
  });

  it('drops the monitoring settings table', async () => {
    const queryRunner = { query: jest.fn() };

    await migration.down(queryRunner as never);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('DROP TABLE IF EXISTS'),
    );
  });
});
