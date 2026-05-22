import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenPushNotificationDeliveries1716600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "push_notification_deliveries"
        ADD COLUMN IF NOT EXISTS "push_payload" jsonb,
        ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "max_attempts" integer NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "locked_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_push_deliveries_retry_due"
        ON "push_notification_deliveries" ("status", "next_attempt_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_push_deliveries_retry_due"
    `);

    await queryRunner.query(`
      ALTER TABLE "push_notification_deliveries"
        DROP COLUMN IF EXISTS "updated_at",
        DROP COLUMN IF EXISTS "locked_at",
        DROP COLUMN IF EXISTS "next_attempt_at",
        DROP COLUMN IF EXISTS "last_attempt_at",
        DROP COLUMN IF EXISTS "max_attempts",
        DROP COLUMN IF EXISTS "attempt_count",
        DROP COLUMN IF EXISTS "push_payload"
    `);
  }
}
