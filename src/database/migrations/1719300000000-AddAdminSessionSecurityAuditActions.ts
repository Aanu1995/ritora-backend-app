import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminSessionSecurityAuditActions1719300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
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
            'user_unrestricted'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'admin_logged_out'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'admin_session_revoked'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'admin_sessions_revoked'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_sessions_admin_last_used_at"
      ON "admin_sessions" ("admin_id", "last_used_at" DESC)
      WHERE "revoked_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_sessions_admin_last_used_at"`,
    );
    // PostgreSQL enum values cannot be safely removed without recreating the type.
  }
}
