import { QueryRunner } from 'typeorm';
import { OptimizeRoutineMemoryReadPaths1723900000000 } from '../1723900000000-OptimizeRoutineMemoryReadPaths';

describe('OptimizeRoutineMemoryReadPaths1723900000000', () => {
  it('creates the simplification timeline index without blocking writes', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;
    const migration = new OptimizeRoutineMemoryReadPaths1723900000000();

    expect(migration.transaction).toBe(false);

    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(sql).toContain(
      'ON "routine_simplification_events" ("user_id", "started_at")',
    );
    expect(sql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_simplification_user_started"',
    );
  });
});
