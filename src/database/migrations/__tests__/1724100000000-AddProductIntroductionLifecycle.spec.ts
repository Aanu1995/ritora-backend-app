import { QueryRunner } from 'typeorm';
import { AddProductIntroductionLifecycle1724100000000 } from '../1724100000000-AddProductIntroductionLifecycle';

describe('AddProductIntroductionLifecycle1724100000000', () => {
  it('adds lifecycle columns and creates the filter index concurrently', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;
    const migration = new AddProductIntroductionLifecycle1724100000000();

    expect(migration.transaction).toBe(false);

    await migration.up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "introduction_status"');
    expect(sql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS');
    expect(sql).toContain('"IDX_inventory_products_user_introduction_status"');
    expect(sql).toContain(
      'ON "inventory_products" ("user_id", "introduction_status")',
    );
  });
});
