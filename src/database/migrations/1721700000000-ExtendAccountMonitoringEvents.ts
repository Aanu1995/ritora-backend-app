import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE_EVENT_TYPES = [
  'account_deletion_cancelled',
  'account_deletion_requested',
  'auth_login_failed',
  'password_reset_requested',
  'skin_journal_photo_upload_failed',
] as const;

const EXTENDED_EVENT_TYPES = [
  ...BASE_EVENT_TYPES,
  'oauth_login_failed',
  'support_escalation_received',
] as const;

function eventTypeCheck(types: readonly string[]): string {
  return types.map((type) => `'${type}'`).join(', ');
}

export class ExtendAccountMonitoringEvents1721700000000 implements MigrationInterface {
  public readonly transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "account_monitoring_events"
      DROP CONSTRAINT IF EXISTS "CK_account_monitoring_events_type"
    `);

    await queryRunner.query(`
      ALTER TABLE "account_monitoring_events"
      ADD CONSTRAINT "CK_account_monitoring_events_type" CHECK (
        "event_type" IN (${eventTypeCheck(EXTENDED_EVENT_TYPES)})
      )
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_account_monitoring_events_user_oauth_support_scan"
      ON "account_monitoring_events" ("event_type", "occurred_at" DESC, "user_id")
      WHERE "user_id" IS NOT NULL
        AND "event_type" IN ('oauth_login_failed', 'support_escalation_received')
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_account_monitoring_events_unknown_oauth_email_scan"
      ON "account_monitoring_events" ("event_type", "occurred_at" DESC, "email_hash")
      WHERE "user_id" IS NULL
        AND "email_hash" IS NOT NULL
        AND "event_type" = 'oauth_login_failed'
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_account_monitoring_events_unknown_oauth_ip_scan"
      ON "account_monitoring_events" ("event_type", "occurred_at" DESC, "ip_address_hash")
      WHERE "user_id" IS NULL
        AND "ip_address_hash" IS NOT NULL
        AND "event_type" = 'oauth_login_failed'
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_skin_journal_media_deletion_jobs_global_failed_scan"
      ON "skin_journal_media_deletion_jobs" ("updated_at" DESC)
      INCLUDE ("attempt_count")
      WHERE "status" = 'failed'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_skin_journal_media_deletion_jobs_global_failed_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_account_monitoring_events_unknown_oauth_ip_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_account_monitoring_events_unknown_oauth_email_scan"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "idx_account_monitoring_events_user_oauth_support_scan"`,
    );

    await queryRunner.query(`
      DELETE FROM "account_monitoring_events"
      WHERE "event_type" IN ('oauth_login_failed', 'support_escalation_received')
    `);

    await queryRunner.query(`
      ALTER TABLE "account_monitoring_events"
      DROP CONSTRAINT IF EXISTS "CK_account_monitoring_events_type"
    `);

    await queryRunner.query(`
      ALTER TABLE "account_monitoring_events"
      ADD CONSTRAINT "CK_account_monitoring_events_type" CHECK (
        "event_type" IN (${eventTypeCheck(BASE_EVENT_TYPES)})
      )
    `);
  }
}
