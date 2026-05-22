import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a stable notification dedupe key so polling workers can dispatch
 * suggestion_ready, slot_start, and recording_reminder safely without
 * creating repeated in-app rows during the same notification window.
 */
export class AddNotificationDedupeKey1715200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD COLUMN "dedupe_key" varchar(160)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_in_app_notifications_user_kind_dedupe"
        ON "in_app_notifications" ("user_id", "kind", "dedupe_key")
        WHERE "dedupe_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_in_app_notifications_user_kind_dedupe"
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP COLUMN IF EXISTS "dedupe_key"
    `);
  }
}
