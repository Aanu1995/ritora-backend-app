import { BackfillProductIntroductionTolerated1724300000000 } from '../1724300000000-BackfillProductIntroductionTolerated';

function queryRunnerMock() {
  return {
    query: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  };
}

describe('BackfillProductIntroductionTolerated1724300000000', () => {
  it('drops the old active-trial guard and backfills legacy null statuses in small batches', async () => {
    const migration = new BackfillProductIntroductionTolerated1724300000000();
    const queryRunner = queryRunnerMock();

    await migration.up(queryRunner as never);

    const statements = queryRunner.query.mock.calls.map(([sql]) => sql);
    expect(migration.transaction).toBe(false);
    expect(statements.join('\n')).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_inventory_products_one_active_introduction_trial"',
    );
    expect(statements.join('\n')).toContain(
      '"introduction_status" = \'tolerated\'',
    );
    expect(statements.join('\n')).toContain(
      'WHERE "introduction_status" IS NULL',
    );
    expect(statements.join('\n')).toContain('FOR UPDATE SKIP LOCKED');
    expect(statements.join('\n')).toContain('LIMIT 5000');
    expect(statements.join('\n')).toContain('RETURNING inventory."id"');
  });

  it('continues batching until the final batch is smaller than the batch size', async () => {
    const migration = new BackfillProductIntroductionTolerated1724300000000();
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(
          Array.from({ length: 5000 }, (_, index) => ({
            id: `product-${index}`,
          })),
        )
        .mockResolvedValueOnce([{ id: 'last-product' }]),
    };

    await migration.up(queryRunner as never);

    expect(queryRunner.query).toHaveBeenCalledTimes(3);
  });

  it('does not reverse tolerated backfills because the old null rows are not knowable', async () => {
    const migration = new BackfillProductIntroductionTolerated1724300000000();
    const queryRunner = queryRunnerMock();

    await migration.down(queryRunner as never);

    expect(queryRunner.query).not.toHaveBeenCalled();
  });
});
