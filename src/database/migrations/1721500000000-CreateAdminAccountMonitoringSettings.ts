import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminAccountMonitoringSettings1721500000000 implements MigrationInterface {
  name = 'CreateAdminAccountMonitoringSettings1721500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_account_monitoring_settings" (
        "id" varchar(32) NOT NULL,
        "thresholds" jsonb NOT NULL,
        "updated_by_admin_id" varchar(26),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_account_monitoring_settings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_admin_account_monitoring_settings_updated_by"
          FOREIGN KEY ("updated_by_admin_id")
          REFERENCES "admin_accounts"("id")
          ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      INSERT INTO "admin_account_monitoring_settings" ("id", "thresholds")
      VALUES (
        'default',
        '{
          "aiCost24hCriticalUsd": 5,
          "aiCost24hWarningUsd": 2,
          "aiGenerations24hCritical": 50,
          "aiGenerations24hWarning": 25,
          "authFailures24hWarning": 8,
          "deletionEvents30dWarning": 3,
          "mediaCleanupAttempts24hWarning": 6,
          "mediaCleanupFailures24hWarning": 3,
          "passwordResets24hWarning": 5,
          "productExtractions24hWarning": 20,
          "safetyReactionSignals7dWarning": 3,
          "unknownAuthFailures24hCritical": 20,
          "unknownAuthFailures24hWarning": 8,
          "uploadFailures24hWarning": 5
        }'::jsonb
      )
      ON CONFLICT ("id") DO NOTHING
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'admin_audit_action'
        ) THEN
          ALTER TYPE "admin_audit_action"
          ADD VALUE IF NOT EXISTS 'account_monitoring_settings_updated';
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "admin_account_monitoring_settings"
    `);
  }
}
