import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeAdminAiCostPerUserIndexes1720800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_entries_ai_cost_user_started"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_insight_runs_user_completed_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suggestion_instances_ai_cost_user_generated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_check_ai_review_metrics_user_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_snapshots_user_generated_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_generation_jobs_user_updated_cost"`,
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_entries_ai_cost_user_started"
      ON "skin_journal_entries" ("user_id", "analysis_started_at" DESC)
      INCLUDE ("analysis_estimated_cost_usd")
      WHERE "analysis_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_insight_runs_user_completed_cost"
      ON "skin_journal_insight_generation_runs" ("user_id", "completed_at" DESC)
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_suggestion_instances_ai_cost_user_generated"
      ON "suggestion_instances" ("user_id", "generated_at" DESC)
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_check_ai_review_metrics_user_cost"
      ON "product_check_ai_review_metrics" ("user_id", "occurred_at" DESC)
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "user_id" IS NOT NULL
        AND "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_snapshots_user_generated_cost"
      ON "smart_pick_snapshots" ("user_id", "generated_at" DESC)
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_generation_jobs_user_updated_cost"
      ON "smart_pick_generation_jobs" ("user_id", "updated_at" DESC)
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_generation_jobs_user_updated_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_snapshots_user_generated_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_check_ai_review_metrics_user_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suggestion_instances_ai_cost_user_generated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_insight_runs_user_completed_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_entries_ai_cost_user_started"`,
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_entries_ai_cost_user_started"
      ON "skin_journal_entries" ("analysis_started_at", "user_id")
      WHERE "analysis_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_insight_runs_user_completed_cost"
      ON "skin_journal_insight_generation_runs" ("completed_at", "user_id")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_suggestion_instances_ai_cost_user_generated"
      ON "suggestion_instances" ("generated_at", "user_id")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_check_ai_review_metrics_user_cost"
      ON "product_check_ai_review_metrics" ("user_id", "occurred_at" DESC)
      WHERE "user_id" IS NOT NULL
        AND "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_snapshots_user_generated_cost"
      ON "smart_pick_snapshots" ("generated_at", "user_id")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_generation_jobs_user_updated_cost"
      ON "smart_pick_generation_jobs" ("updated_at", "user_id")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);
  }
}
