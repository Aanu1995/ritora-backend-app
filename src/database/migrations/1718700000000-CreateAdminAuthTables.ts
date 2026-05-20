import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminAuthTables1718700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "admin_account_role" AS ENUM ('root', 'admin')
    `);

    await queryRunner.query(`
      CREATE TYPE "admin_account_status" AS ENUM ('invited', 'active', 'disabled')
    `);

    await queryRunner.query(`
      CREATE TYPE "admin_audit_action" AS ENUM ('admin_invited', 'admin_deleted')
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_accounts" (
        "id" varchar(26) NOT NULL,
        "email" varchar(255) NOT NULL,
        "canonical_email" varchar(255) NOT NULL,
        "name" varchar(120) NOT NULL,
        "role" "admin_account_role" NOT NULL DEFAULT 'admin',
        "status" "admin_account_status" NOT NULL DEFAULT 'invited',
        "password_hash" varchar(255),
        "invitation_token_hash" varchar(255),
        "invitation_expires_at" timestamptz,
        "password_reset_token_hash" varchar(255),
        "password_reset_expires" timestamptz,
        "created_by_admin_id" varchar(26),
        "accepted_at" timestamptz,
        "last_login_at" timestamptz,
        "deleted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_admin_accounts_created_by" FOREIGN KEY ("created_by_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_admin_accounts_canonical_email_active"
        ON "admin_accounts" ("canonical_email")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_accounts_deleted_at"
        ON "admin_accounts" ("deleted_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_sessions" (
        "id" varchar(26) NOT NULL,
        "admin_id" varchar(26) NOT NULL,
        "refresh_token_hash" varchar(255) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "user_agent" varchar(500),
        "ip_address" varchar(45),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "last_used_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_admin_sessions_admin" FOREIGN KEY ("admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_sessions_admin_id"
        ON "admin_sessions" ("admin_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_audit_logs" (
        "id" varchar(26) NOT NULL,
        "action" "admin_audit_action" NOT NULL,
        "actor_admin_id" varchar(26) NOT NULL,
        "actor_session_id" varchar(26) NOT NULL,
        "target_admin_id" varchar(26),
        "reason" varchar(500) NOT NULL,
        "ip_address" varchar(45),
        "user_agent" varchar(500),
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_admin_audit_logs_actor_admin" FOREIGN KEY ("actor_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_admin_audit_logs_target_admin" FOREIGN KEY ("target_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_audit_logs_actor_admin_id"
        ON "admin_audit_logs" ("actor_admin_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_audit_logs_target_admin_id"
        ON "admin_audit_logs" ("target_admin_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_admin_audit_logs_created_at"
        ON "admin_audit_logs" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_admin_audit_logs_created_at"`);
    await queryRunner.query(
      `DROP INDEX "idx_admin_audit_logs_target_admin_id"`,
    );
    await queryRunner.query(`DROP INDEX "idx_admin_audit_logs_actor_admin_id"`);
    await queryRunner.query(`DROP TABLE "admin_audit_logs"`);
    await queryRunner.query(`DROP TABLE "admin_sessions"`);
    await queryRunner.query(`DROP INDEX "idx_admin_accounts_deleted_at"`);
    await queryRunner.query(
      `DROP INDEX "idx_admin_accounts_canonical_email_active"`,
    );
    await queryRunner.query(`DROP TABLE "admin_accounts"`);
    await queryRunner.query(`DROP TYPE "admin_audit_action"`);
    await queryRunner.query(`DROP TYPE "admin_account_status"`);
    await queryRunner.query(`DROP TYPE "admin_account_role"`);
  }
}
