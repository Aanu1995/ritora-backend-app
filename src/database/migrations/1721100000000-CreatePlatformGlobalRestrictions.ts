import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformGlobalRestrictions1721100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_global_restrictions" (
        "id" varchar(26) NOT NULL,
        "capability" varchar(80) NOT NULL,
        "reason" varchar(500) NOT NULL,
        "internal_note" text NOT NULL,
        "enabled_by_admin_id" varchar(26) NOT NULL,
        "enabled_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz,
        "disabled_at" timestamptz,
        "disabled_by_admin_id" varchar(26),
        "disable_reason" varchar(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_global_restrictions" PRIMARY KEY ("id"),
        CONSTRAINT "CK_platform_global_restrictions_capability" CHECK (
          "capability" IN (
            'disable_account_creation',
            'disable_ai_generation',
            'disable_image_upload',
            'disable_product_extraction',
            'disable_notifications'
          )
        ),
        CONSTRAINT "FK_platform_global_restrictions_enabled_by" FOREIGN KEY ("enabled_by_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_platform_global_restrictions_disabled_by" FOREIGN KEY ("disabled_by_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_platform_global_restrictions_open_capability"
      ON "platform_global_restrictions" ("capability")
      WHERE "disabled_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_global_restrictions_active_lookup"
      ON "platform_global_restrictions" ("capability", "enabled_at" DESC, "id" DESC)
      WHERE "disabled_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_global_restrictions_disabled_at"
      ON "platform_global_restrictions" ("disabled_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_global_restrictions_expires_at"
      ON "platform_global_restrictions" ("expires_at")
      WHERE "disabled_at" IS NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'admin_audit_action'
        ) THEN
          CREATE TYPE "admin_audit_action" AS ENUM (
            'admin_invited',
            'admin_deleted',
            'admin_invitation_resent',
            'admin_logged_out',
            'admin_session_revoked',
            'admin_sessions_revoked',
            'admin_mfa_enabled',
            'admin_mfa_disabled',
            'admin_mfa_recovery_codes_rotated',
            'admin_mfa_recovery_code_used',
            'user_restricted',
            'user_unrestricted',
            'user_note_created',
            'operational_incident_created',
            'operational_incident_resolved'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'platform_global_restriction_enabled'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'platform_global_restriction_disabled'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_platform_global_restrictions_expires_at"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_platform_global_restrictions_disabled_at"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_platform_global_restrictions_active_lookup"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_platform_global_restrictions_open_capability"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "platform_global_restrictions"
    `);
    // PostgreSQL enum values cannot be safely removed without recreating the type.
  }
}
