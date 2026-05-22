import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeAccountMonitoringScanIndexes1721600000000 implements MigrationInterface {
  public readonly transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_account_monitoring_events_user_scan"
      ON "account_monitoring_events" ("event_type", "occurred_at" DESC, "user_id")
      WHERE "user_id" IS NOT NULL
        AND "event_type" IN (
          'account_deletion_cancelled',
          'account_deletion_requested',
          'auth_login_failed',
          'password_reset_requested',
          'skin_journal_photo_upload_failed'
        )
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_account_monitoring_events_unknown_email_scan"
      ON "account_monitoring_events" ("event_type", "occurred_at" DESC, "email_hash")
      WHERE "user_id" IS NULL
        AND "email_hash" IS NOT NULL
        AND "event_type" IN ('auth_login_failed', 'password_reset_requested')
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_account_monitoring_events_unknown_ip_scan"
      ON "account_monitoring_events" ("event_type", "occurred_at" DESC, "ip_address_hash")
      WHERE "user_id" IS NULL
        AND "ip_address_hash" IS NOT NULL
        AND "event_type" = 'auth_login_failed'
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_analysis_jobs_failed_scan"
      ON "skin_journal_analysis_jobs" ("updated_at" DESC, "user_id")
      WHERE "user_id" IS NOT NULL
        AND "status" = 'failed'
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_insight_runs_failed_scan"
      ON "skin_journal_insight_generation_runs" ((COALESCE("completed_at", "created_at")) DESC, "user_id")
      WHERE "user_id" IS NOT NULL
        AND "status" = 'failed'
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_suggestion_generation_jobs_failed_scan"
      ON "suggestion_generation_jobs" ("updated_at" DESC, "user_id")
      WHERE "user_id" IS NOT NULL
        AND "status" = 'failed'
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_smart_pick_generation_jobs_failed_scan"
      ON "smart_pick_generation_jobs" ("updated_at" DESC, "user_id")
      WHERE "user_id" IS NOT NULL
        AND "status" = 'failed'
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_media_deletion_jobs_failed_scan"
      ON "skin_journal_media_deletion_jobs" ("updated_at" DESC, "user_id")
      INCLUDE ("attempt_count")
      WHERE "user_id" IS NOT NULL
        AND "status" = 'failed'
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_events_reaction_scan"
      ON "skin_journal_events" ("created_at" DESC, "user_id")
      WHERE "user_id" IS NOT NULL
        AND "kind" = 'reaction_detected'
        AND "severity" IN ('warning', 'critical')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_skin_journal_events_reaction_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_skin_journal_media_deletion_jobs_failed_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_smart_pick_generation_jobs_failed_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_suggestion_generation_jobs_failed_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_skin_journal_insight_runs_failed_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_skin_journal_analysis_jobs_failed_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_account_monitoring_events_unknown_ip_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_account_monitoring_events_unknown_email_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_account_monitoring_events_user_scan"`,
    );
  }
}
