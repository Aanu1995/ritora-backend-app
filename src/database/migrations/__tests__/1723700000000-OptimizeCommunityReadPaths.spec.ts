import { OptimizeCommunityReadPaths1723700000000 } from '../1723700000000-OptimizeCommunityReadPaths';

function queryRunnerMock() {
  return {
    query: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  };
}

describe('OptimizeCommunityReadPaths1723700000000', () => {
  it('adds partial covering indexes for hot community read paths', async () => {
    const migration = new OptimizeCommunityReadPaths1723700000000();
    const queryRunner = queryRunnerMock();

    await migration.up(queryRunner as never);

    const statements = queryRunner.query.mock.calls.map(([sql]) => sql);
    expect(migration.transaction).toBe(false);
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CREATE EXTENSION IF NOT EXISTS "pg_trgm"'),
        expect.stringContaining('idx_comm_reviews_public_newest'),
        expect.stringContaining('idx_comm_routines_public_newest'),
        expect.stringContaining('idx_comm_reviews_product_name_trgm'),
        expect.stringContaining('idx_comm_reviews_product_brand_trgm'),
        expect.stringContaining('idx_comm_reviews_body_trgm'),
        expect.stringContaining('idx_comm_routines_title_trgm'),
        expect.stringContaining('idx_comm_routines_summary_trgm'),
        expect.stringContaining('idx_comm_routine_steps_product_name_trgm'),
        expect.stringContaining('idx_comm_review_context_product_name_trgm'),
        expect.stringContaining('idx_comm_outcome_results_public_newest'),
        expect.stringContaining('idx_comm_outcome_results_public_signal'),
        expect.stringContaining('idx_comm_routines_author_active_updated'),
        expect.stringContaining('idx_comm_reviews_author_active_updated'),
        expect.stringContaining('idx_comm_outcome_votes_user_active_updated'),
      ]),
    );
    expect(statements.join('\n')).toContain('CREATE INDEX CONCURRENTLY');
    expect(statements.join('\n')).toContain('gin_trgm_ops');
    expect(statements.join('\n')).toContain('"withdrawn_at" IS NULL');
  });

  it('drops the optimized community indexes on rollback', async () => {
    const migration = new OptimizeCommunityReadPaths1723700000000();
    const queryRunner = queryRunnerMock();

    await migration.down(queryRunner as never);

    expect(queryRunner.query.mock.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DROP INDEX CONCURRENTLY IF EXISTS'),
        expect.stringContaining('idx_comm_reviews_product_name_trgm'),
        expect.stringContaining('idx_comm_reviews_product_brand_trgm'),
        expect.stringContaining('idx_comm_reviews_body_trgm'),
        expect.stringContaining('idx_comm_routines_title_trgm'),
        expect.stringContaining('idx_comm_routines_summary_trgm'),
        expect.stringContaining('idx_comm_routine_steps_product_name_trgm'),
        expect.stringContaining('idx_comm_review_context_product_name_trgm'),
        expect.stringContaining('idx_comm_reviews_public_newest'),
        expect.stringContaining('idx_comm_routines_public_newest'),
        expect.stringContaining('idx_comm_outcome_results_public_newest'),
        expect.stringContaining('idx_comm_outcome_results_public_signal'),
        expect.stringContaining('idx_comm_routines_author_active_updated'),
        expect.stringContaining('idx_comm_reviews_author_active_updated'),
        expect.stringContaining('idx_comm_outcome_votes_user_active_updated'),
      ]),
    );
  });
});
