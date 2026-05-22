import { QueryRunner } from 'typeorm';
import { OptimizeAccountMonitoringScanIndexes1721600000000 } from '../1721600000000-OptimizeAccountMonitoringScanIndexes';

describe('OptimizeAccountMonitoringScanIndexes1721600000000', () => {
  it('creates targeted scan indexes concurrently', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;
    const migration = new OptimizeAccountMonitoringScanIndexes1721600000000();

    expect(migration.transaction).toBe(false);

    await migration.up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_account_monitoring_events_user_scan"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_account_monitoring_events_unknown_email_scan"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_account_monitoring_events_unknown_ip_scan"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_analysis_jobs_failed_scan"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_insight_runs_failed_scan"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_suggestion_generation_jobs_failed_scan"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_smart_pick_generation_jobs_failed_scan"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_media_deletion_jobs_failed_scan"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_events_reaction_scan"',
    );
    expect(sql).toContain('WHERE "user_id" IS NULL');
    expect(sql).toContain('WHERE "user_id" IS NOT NULL');
    expect(sql).toContain('AND "status" = \'failed\'');
    expect(sql).toContain('INCLUDE ("attempt_count")');
  });

  it('drops targeted scan indexes concurrently on rollback', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new OptimizeAccountMonitoringScanIndexes1721600000000().down(
      queryRunner,
    );

    expect(queries).toHaveLength(9);
    expect(queries[0]).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "idx_skin_journal_events_reaction_scan"',
    );
    expect(queries.at(-1)).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "idx_account_monitoring_events_user_scan"',
    );
  });
});
