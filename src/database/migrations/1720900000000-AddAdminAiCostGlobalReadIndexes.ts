import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminAiCostGlobalReadIndexes1720900000000 implements MigrationInterface {
  public readonly transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_entries_ai_cost_started_user"
      ON "skin_journal_entries" ("analysis_started_at" DESC, "user_id")
      INCLUDE ("analysis_estimated_cost_usd")
      WHERE "user_id" IS NOT NULL
        AND "analysis_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_insight_runs_completed_user_cost"
      ON "skin_journal_insight_generation_runs" ("completed_at" DESC, "user_id")
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "user_id" IS NOT NULL
        AND "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_suggestion_instances_ai_cost_generated_user"
      ON "suggestion_instances" ("generated_at" DESC, "user_id")
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "user_id" IS NOT NULL
        AND "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_check_ai_review_metrics_cost_user"
      ON "product_check_ai_review_metrics" ("occurred_at" DESC, "user_id")
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "user_id" IS NOT NULL
        AND "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_smart_pick_snapshots_generated_user_cost"
      ON "smart_pick_snapshots" ("generated_at" DESC, "user_id")
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "user_id" IS NOT NULL
        AND "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_smart_pick_generation_jobs_updated_user_cost"
      ON "smart_pick_generation_jobs" ("updated_at" DESC, "user_id")
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "user_id" IS NOT NULL
        AND "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_skin_journal_entries_ai_cost_started"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_skin_journal_insight_runs_completed_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_suggestion_instances_ai_cost_generated"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_product_check_ai_review_metrics_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_smart_pick_snapshots_generated_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_smart_pick_generation_jobs_updated_cost"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_entries_ai_cost_started"
      ON "skin_journal_entries" ("analysis_started_at")
      WHERE "analysis_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_insight_runs_completed_cost"
      ON "skin_journal_insight_generation_runs" ("completed_at")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_suggestion_instances_ai_cost_generated"
      ON "suggestion_instances" ("generated_at")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_check_ai_review_metrics_cost"
      ON "product_check_ai_review_metrics" ("occurred_at" DESC)
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_snapshots_generated_cost"
      ON "smart_pick_snapshots" ("generated_at")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_generation_jobs_updated_cost"
      ON "smart_pick_generation_jobs" ("updated_at")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_generation_jobs_updated_user_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_snapshots_generated_user_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_check_ai_review_metrics_cost_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suggestion_instances_ai_cost_generated_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_insight_runs_completed_user_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_entries_ai_cost_started_user"`,
    );
  }
}
