import { QueryRunner } from 'typeorm';
import { OptimizeRoutineMemoryProductUsageIndexes1724400000000 } from '../1724400000000-OptimizeRoutineMemoryProductUsageIndexes';

describe('OptimizeRoutineMemoryProductUsageIndexes1724400000000', () => {
  it('creates targeted indexes for lifetime product usage reads concurrently', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;
    const migration =
      new OptimizeRoutineMemoryProductUsageIndexes1724400000000();

    expect(migration.transaction).toBe(false);

    await migration.up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(sql).toContain('"IDX_application_items_inventory_product_usage"');
    expect(sql).toContain(
      'ON "application_log_items" ("inventory_product_id", "status", "application_log_id")',
    );
    expect(sql).toContain('WHERE "inventory_product_id" IS NOT NULL');
    expect(sql).toContain('"IDX_application_items_substituted_product_usage"');
    expect(sql).toContain(
      'ON "application_log_items" ("substituted_with_product_id", "status", "application_log_id")',
    );
    expect(sql).toContain('WHERE "substituted_with_product_id" IS NOT NULL');
  });

  it('drops product usage indexes concurrently on rollback', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new OptimizeRoutineMemoryProductUsageIndexes1724400000000().down(
      queryRunner,
    );

    expect(queries).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_application_items_substituted_product_usage"',
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_application_items_inventory_product_usage"',
    ]);
  });
});
