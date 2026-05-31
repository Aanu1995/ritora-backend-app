import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeCommunityReadPaths1723700000000 implements MigrationInterface {
  public readonly transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_reviews_public_newest"
      ON "community_reviews" ("updated_at" DESC, "id" DESC)
      WHERE "moderation_status" = 'published'
        AND "withdrawn_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_routines_public_newest"
      ON "community_routines" ("updated_at" DESC, "id" DESC)
      WHERE "moderation_status" = 'published'
        AND "withdrawn_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_reviews_product_name_trgm"
      ON "community_reviews" USING gin ("product_name" gin_trgm_ops)
      WHERE "moderation_status" = 'published'
        AND "withdrawn_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_reviews_product_brand_trgm"
      ON "community_reviews" USING gin ("product_brand" gin_trgm_ops)
      WHERE "moderation_status" = 'published'
        AND "withdrawn_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_reviews_body_trgm"
      ON "community_reviews" USING gin ("body" gin_trgm_ops)
      WHERE "moderation_status" = 'published'
        AND "withdrawn_at" IS NULL
        AND "body" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_routines_title_trgm"
      ON "community_routines" USING gin ("title" gin_trgm_ops)
      WHERE "moderation_status" = 'published'
        AND "withdrawn_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_routines_summary_trgm"
      ON "community_routines" USING gin ("summary" gin_trgm_ops)
      WHERE "moderation_status" = 'published'
        AND "withdrawn_at" IS NULL
        AND "summary" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_routine_steps_product_name_trgm"
      ON "community_routine_steps" USING gin ("product_name" gin_trgm_ops)
      WHERE "product_name" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_review_context_product_name_trgm"
      ON "community_review_context_products" USING gin ("product_name" gin_trgm_ops)
      WHERE "product_name" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_outcome_results_public_newest"
      ON "community_outcome_signal_votes" (
        "content_type",
        "content_id",
        "created_at" DESC,
        "id" DESC
      )
      INCLUDE ("signal")
      WHERE "note_moderation_status" = 'published'
        AND "withdrawn_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_outcome_results_public_signal"
      ON "community_outcome_signal_votes" (
        "content_type",
        "content_id",
        "signal",
        "created_at" DESC,
        "id" DESC
      )
      WHERE "note_moderation_status" = 'published'
        AND "withdrawn_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_routines_author_active_updated"
      ON "community_routines" (
        "author_user_id",
        "updated_at" DESC,
        "id" DESC
      )
      WHERE "withdrawn_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_reviews_author_active_updated"
      ON "community_reviews" (
        "author_user_id",
        "updated_at" DESC,
        "id" DESC
      )
      WHERE "withdrawn_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_comm_outcome_votes_user_active_updated"
      ON "community_outcome_signal_votes" (
        "user_id",
        "updated_at" DESC,
        "id" DESC
      )
      WHERE "withdrawn_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_review_context_product_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_routine_steps_product_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_routines_summary_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_routines_title_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_reviews_body_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_reviews_product_brand_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_reviews_product_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_outcome_votes_user_active_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_reviews_author_active_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_routines_author_active_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_outcome_results_public_signal"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_outcome_results_public_newest"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_routines_public_newest"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_comm_reviews_public_newest"`,
    );
  }
}
