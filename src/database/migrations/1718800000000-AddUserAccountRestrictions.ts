import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAccountRestrictions1718800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "account_restricted_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "account_restriction_reason" varchar(500),
        ADD COLUMN IF NOT EXISTS "account_restricted_by_admin_id" varchar(26)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_account_restricted_at"
      ON "users" ("account_restricted_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_account_restricted_by_admin_id"
      ON "users" ("account_restricted_by_admin_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_auth_sessions_user_last_used_at"
      ON "auth_sessions" ("user_id", "last_used_at" DESC)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_users_account_restricted_by_admin_id'
            AND conrelid = '"users"'::regclass
        ) THEN
          ALTER TABLE "users"
          ADD CONSTRAINT "fk_users_account_restricted_by_admin_id"
          FOREIGN KEY ("account_restricted_by_admin_id")
          REFERENCES "admin_accounts"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
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
            'admin_deleted'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'admin_invitation_resent'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'user_restricted'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'user_unrestricted'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
        "id" varchar(26) NOT NULL,
        "action" "admin_audit_action" NOT NULL,
        "actor_admin_id" varchar(26) NOT NULL,
        "actor_session_id" varchar(26) NOT NULL,
        "target_admin_id" varchar(26),
        "target_user_id" varchar(26),
        "reason" varchar(500) NOT NULL,
        "ip_address" varchar(45),
        "user_agent" varchar(500),
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_audit_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_admin_audit_logs_actor_admin'
            AND conrelid = '"admin_audit_logs"'::regclass
        ) THEN
          ALTER TABLE "admin_audit_logs"
          ADD CONSTRAINT "FK_admin_audit_logs_actor_admin"
          FOREIGN KEY ("actor_admin_id")
          REFERENCES "admin_accounts"("id")
          ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_admin_audit_logs_target_admin'
            AND conrelid = '"admin_audit_logs"'::regclass
        ) THEN
          ALTER TABLE "admin_audit_logs"
          ADD CONSTRAINT "FK_admin_audit_logs_target_admin"
          FOREIGN KEY ("target_admin_id")
          REFERENCES "admin_accounts"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_actor_admin_id"
      ON "admin_audit_logs" ("actor_admin_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_target_admin_id"
      ON "admin_audit_logs" ("target_admin_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_created_at"
      ON "admin_audit_logs" ("created_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "admin_audit_logs"
      ADD COLUMN IF NOT EXISTS "target_user_id" varchar(26)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_target_user_id"
      ON "admin_audit_logs" ("target_user_id")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_admin_audit_logs_target_user_id'
            AND conrelid = '"admin_audit_logs"'::regclass
        ) THEN
          ALTER TABLE "admin_audit_logs"
          ADD CONSTRAINT "fk_admin_audit_logs_target_user_id"
          FOREIGN KEY ("target_user_id")
          REFERENCES "users"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "admin_audit_logs"
      DROP CONSTRAINT IF EXISTS "fk_admin_audit_logs_target_user_id"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_admin_audit_logs_target_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "admin_audit_logs"
      DROP COLUMN IF EXISTS "target_user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP CONSTRAINT IF EXISTS "fk_users_account_restricted_by_admin_id"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_users_account_restricted_by_admin_id"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_auth_sessions_user_last_used_at"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_users_account_restricted_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "account_restricted_by_admin_id",
        DROP COLUMN IF EXISTS "account_restriction_reason",
        DROP COLUMN IF EXISTS "account_restricted_at"
    `);
  }
}
