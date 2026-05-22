import { QueryRunner } from 'typeorm';
import { CreateProductAnalyticsEvents1720000000000 } from '../1720000000000-CreateProductAnalyticsEvents';

describe('CreateProductAnalyticsEvents1720000000000', () => {
  it('creates durable product events with backfills and idempotent triggers', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new CreateProductAnalyticsEvents1720000000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "product_analytics_events"',
    );
    expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(sql).toContain("'account_created'");
    expect(sql).toContain("'inventory_product_created'");
    expect(sql).toContain("'journal_check_in_created'");
    expect(sql).toContain("'smart_pick_snapshot_generated'");
    expect(sql).toContain('CREATE TRIGGER "trg_product_analytics_users"');
    expect(sql).not.toContain('email ');
    expect(sql).not.toContain('photo_object_key');
    expect(sql).not.toContain('general_notes');
  });
});
