import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountMonitoringEvents1721300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "account_monitoring_events" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26),
        "event_type" varchar(60) NOT NULL,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "email_hash" varchar(64),
        "ip_address_hash" varchar(64),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_monitoring_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_account_monitoring_events_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_account_monitoring_events_type" CHECK (
          "event_type" IN (
            'account_deletion_cancelled',
            'account_deletion_requested',
            'auth_login_failed',
            'password_reset_requested',
            'skin_journal_photo_upload_failed'
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_account_monitoring_events_user_type_time"
      ON "account_monitoring_events" ("user_id", "event_type", "occurred_at" DESC)
      WHERE "user_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_account_monitoring_events_type_time"
      ON "account_monitoring_events" ("event_type", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_account_monitoring_events_email_type_time"
      ON "account_monitoring_events" ("email_hash", "event_type", "occurred_at" DESC)
      WHERE "email_hash" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_account_monitoring_events_ip_type_time"
      ON "account_monitoring_events" ("ip_address_hash", "event_type", "occurred_at" DESC)
      WHERE "ip_address_hash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_account_monitoring_events_ip_type_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_account_monitoring_events_email_type_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_account_monitoring_events_type_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_account_monitoring_events_user_type_time"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "account_monitoring_events"`);
  }
}
