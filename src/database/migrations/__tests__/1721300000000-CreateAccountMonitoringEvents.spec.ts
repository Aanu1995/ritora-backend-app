import { CreateAccountMonitoringEvents1721300000000 } from '../1721300000000-CreateAccountMonitoringEvents';

describe('CreateAccountMonitoringEvents1721300000000', () => {
  it('creates privacy-preserving account monitoring event storage and lookup indexes', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    };

    await new CreateAccountMonitoringEvents1721300000000().up(
      queryRunner as never,
    );

    const sql = queries.join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "account_monitoring_events"',
    );
    expect(sql).toContain('"email_hash" varchar(64)');
    expect(sql).toContain('"ip_address_hash" varchar(64)');
    expect(sql).toContain('"metadata" jsonb NOT NULL');
    expect(sql).toContain('skin_journal_photo_upload_failed');
    expect(sql).toContain('idx_account_monitoring_events_user_type_time');
    expect(sql).toContain('idx_account_monitoring_events_email_type_time');
    expect(sql).toContain('idx_account_monitoring_events_ip_type_time');
  });
});
