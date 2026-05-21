import { QueryRunner } from 'typeorm';
import { AddAdminAiCostGlobalReadIndexes1720900000000 } from '../1720900000000-AddAdminAiCostGlobalReadIndexes';

describe('AddAdminAiCostGlobalReadIndexes1720900000000', () => {
  it('creates date-first covering indexes concurrently before dropping older indexes', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    const migration = new AddAdminAiCostGlobalReadIndexes1720900000000();

    expect(migration.transaction).toBe(false);

    await migration.up(queryRunner);

    const sql = queries.join('\n');
    const firstCreateIndexQuery = queries.findIndex((query) =>
      query.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS'),
    );
    const firstDropIndexQuery = queries.findIndex((query) =>
      query.includes('DROP INDEX CONCURRENTLY IF EXISTS'),
    );

    expect(firstCreateIndexQuery).toBeGreaterThanOrEqual(0);
    expect(firstDropIndexQuery).toBeGreaterThan(firstCreateIndexQuery);
    expect(sql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "idx_skin_journal_entries_ai_cost_started"',
    );
    expect(sql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_entries_ai_cost_started_user"',
    );
    expect(sql).toContain(
      'ON "skin_journal_entries" ("analysis_started_at" DESC, "user_id")',
    );
    expect(sql).toContain(
      'ON "skin_journal_insight_generation_runs" ("completed_at" DESC, "user_id")',
    );
    expect(sql).toContain(
      'ON "suggestion_instances" ("generated_at" DESC, "user_id")',
    );
    expect(sql).toContain(
      'ON "product_check_ai_review_metrics" ("occurred_at" DESC, "user_id")',
    );
    expect(sql).toContain(
      'ON "smart_pick_snapshots" ("generated_at" DESC, "user_id")',
    );
    expect(sql).toContain(
      'ON "smart_pick_generation_jobs" ("updated_at" DESC, "user_id")',
    );
    expect(sql).toContain('INCLUDE ("ai_estimated_cost_usd")');
    expect(sql).toContain('WHERE "user_id" IS NOT NULL');
  });

  it('restores older indexes before dropping date-first covering indexes on rollback', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new AddAdminAiCostGlobalReadIndexes1720900000000().down(queryRunner);

    const firstCreateIndexQuery = queries.findIndex((query) =>
      query.includes(
        'CREATE INDEX IF NOT EXISTS "idx_skin_journal_entries_ai_cost_started"',
      ),
    );
    const firstDropIndexQuery = queries.findIndex((query) =>
      query.includes(
        'DROP INDEX IF EXISTS "idx_smart_pick_generation_jobs_updated_user_cost"',
      ),
    );

    expect(firstCreateIndexQuery).toBeGreaterThanOrEqual(0);
    expect(firstDropIndexQuery).toBeGreaterThan(firstCreateIndexQuery);
  });
});
