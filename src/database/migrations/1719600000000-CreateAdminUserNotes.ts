import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminUserNotes1719600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_user_notes" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "author_admin_id" varchar(26) NOT NULL,
        "body" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_user_notes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_admin_user_notes_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_admin_user_notes_author_admin" FOREIGN KEY ("author_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_user_notes_user_created"
      ON "admin_user_notes" ("user_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_user_notes_author_created"
      ON "admin_user_notes" ("author_admin_id", "created_at" DESC)
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
            'user_unrestricted'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'user_note_created'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_user_notes_author_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_user_notes_user_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_user_notes"`);
    // PostgreSQL enum values cannot be safely removed without recreating the type.
  }
}
