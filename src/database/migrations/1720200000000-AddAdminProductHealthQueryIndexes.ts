import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminProductHealthQueryIndexes1720200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_analytics_events_type_user"
      ON "product_analytics_events" ("event_type", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_analytics_events_user_occurred_type"
      ON "product_analytics_events" ("user_id", "occurred_at", "event_type")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_analytics_events_type_occurred_user"
      ON "product_analytics_events" ("event_type", "occurred_at", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_http_request_metrics_recent_rollup"
      ON "http_request_metrics" ("occurred_at", "method", "route")
      INCLUDE ("duration_ms", "status_code")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_email_verified_true"
      ON "users" ("id")
      WHERE "email_verified" = true
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_data_access_logs_created_at_desc"
      ON "user_data_access_logs" ("created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_target_user_created_at_id_desc"
      ON "admin_audit_logs" ("target_user_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_target_admin_created_at_id_desc"
      ON "admin_audit_logs" ("target_admin_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_entries_ai_cost_started"
      ON "skin_journal_entries" ("analysis_started_at")
      WHERE "analysis_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_suggestion_instances_ai_cost_generated"
      ON "suggestion_instances" ("generated_at")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_entries_analysis_status"
      ON "skin_journal_entries" ("analysis_status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_generation_jobs_status"
      ON "smart_pick_generation_jobs" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_generation_jobs_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_entries_analysis_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suggestion_instances_ai_cost_generated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_entries_ai_cost_started"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_audit_logs_target_admin_created_at_id_desc"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_audit_logs_target_user_created_at_id_desc"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_data_access_logs_created_at_desc"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_email_verified_true"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_http_request_metrics_recent_rollup"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_analytics_events_type_occurred_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_analytics_events_user_occurred_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_analytics_events_type_user"`,
    );
  }
}
