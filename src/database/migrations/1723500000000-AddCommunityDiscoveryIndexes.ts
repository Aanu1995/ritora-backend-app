import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityDiscoveryIndexes1723500000000 implements MigrationInterface {
  name = 'AddCommunityDiscoveryIndexes1723500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_reviews_discovery"
      ON "community_reviews" (
        "moderation_status",
        "withdrawn_at",
        "product_category",
        "updated_at" DESC,
        "id" DESC
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_reviews_context_usage"
      ON "community_reviews" (
        "routine_context_usage",
        "routine_slot",
        "skin_response",
        "usage_duration"
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_reviews_rating"
      ON "community_reviews" ("overall_rating")
      WHERE "overall_rating" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_reviews_safe_facets_gin"
      ON "community_reviews" USING GIN ("safe_facets")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_reviews_outcomes_gin"
      ON "community_reviews" USING GIN ("outcomes")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_reviews_signal_counts_gin"
      ON "community_reviews" USING GIN ("outcome_signal_counts")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_review_context_category"
      ON "community_review_context_products" ("category", "review_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_routines_discovery"
      ON "community_routines" (
        "moderation_status",
        "withdrawn_at",
        "goal_result",
        "timeframe",
        "updated_at" DESC,
        "id" DESC
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_routines_safe_facets_gin"
      ON "community_routines" USING GIN ("safe_facets")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_routines_concerns_gin"
      ON "community_routines" USING GIN ("concern_tags")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_routines_goals_gin"
      ON "community_routines" USING GIN ("goal_tags")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_routines_avoid_gin"
      ON "community_routines" USING GIN ("avoid_tags")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_routines_habits_gin"
      ON "community_routines" USING GIN ("habit_tags")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_routines_warnings_gin"
      ON "community_routines" USING GIN ("warning_tags")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_comm_routine_steps_category"
      ON "community_routine_steps" ("category", "routine_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_routine_steps_category"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_routines_warnings_gin"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_routines_habits_gin"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_routines_avoid_gin"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_routines_goals_gin"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_routines_concerns_gin"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_routines_safe_facets_gin"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_routines_discovery"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_review_context_category"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_reviews_signal_counts_gin"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_reviews_outcomes_gin"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_reviews_safe_facets_gin"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_comm_reviews_rating"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_reviews_context_usage"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_comm_reviews_discovery"`,
    );
  }
}
