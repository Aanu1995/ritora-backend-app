import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminMfa1719500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "admin_accounts"
        ADD COLUMN IF NOT EXISTS "mfa_totp_secret" text,
        ADD COLUMN IF NOT EXISTS "mfa_pending_totp_secret" text,
        ADD COLUMN IF NOT EXISTS "mfa_pending_expires_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "mfa_enabled_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "mfa_last_used_time_step" bigint,
        ADD COLUMN IF NOT EXISTS "mfa_recovery_code_hashes" jsonb
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_accounts_mfa_enabled_at"
      ON "admin_accounts" ("mfa_enabled_at")
      WHERE "mfa_enabled_at" IS NOT NULL
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
            'user_restricted',
            'user_unrestricted',
            'admin_logged_out',
            'admin_session_revoked',
            'admin_sessions_revoked'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'admin_mfa_enabled'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'admin_mfa_disabled'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'admin_mfa_recovery_codes_rotated'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'admin_mfa_recovery_code_used'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_accounts_mfa_enabled_at"`,
    );
    await queryRunner.query(`
      ALTER TABLE "admin_accounts"
        DROP COLUMN IF EXISTS "mfa_recovery_code_hashes",
        DROP COLUMN IF EXISTS "mfa_last_used_time_step",
        DROP COLUMN IF EXISTS "mfa_enabled_at",
        DROP COLUMN IF EXISTS "mfa_pending_expires_at",
        DROP COLUMN IF EXISTS "mfa_pending_totp_secret",
        DROP COLUMN IF EXISTS "mfa_totp_secret"
    `);
    // PostgreSQL enum values cannot be safely removed without recreating the type.
  }
}
