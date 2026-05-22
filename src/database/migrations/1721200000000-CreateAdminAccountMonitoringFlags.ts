import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminAccountMonitoringFlags1721200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'admin_account_monitoring_signal_type'
        ) THEN
          CREATE TYPE "admin_account_monitoring_signal_type" AS ENUM (
            'deletion_compliance_watch',
            'high_ai_cost',
            'manual_watch',
            'product_extraction_abuse',
            'repeated_auth_failures',
            'repeated_upload_failures',
            'safety_critical_reaction_signals',
            'support_escalation'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'admin_account_monitoring_status'
        ) THEN
          CREATE TYPE "admin_account_monitoring_status" AS ENUM (
            'open',
            'watching',
            'resolved'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'admin_account_monitoring_severity'
        ) THEN
          CREATE TYPE "admin_account_monitoring_severity" AS ENUM (
            'info',
            'warning',
            'critical'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_account_monitoring_flags" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "signal_type" "admin_account_monitoring_signal_type" NOT NULL,
        "status" "admin_account_monitoring_status" NOT NULL DEFAULT 'open',
        "severity" "admin_account_monitoring_severity" NOT NULL,
        "summary" varchar(160) NOT NULL,
        "latest_signal" text,
        "internal_note" text,
        "assigned_admin_id" varchar(26),
        "created_by_admin_id" varchar(26) NOT NULL,
        "resolved_by_admin_id" varchar(26),
        "next_review_at" timestamptz,
        "resolved_at" timestamptz,
        "resolution_note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_account_monitoring_flags" PRIMARY KEY ("id"),
        CONSTRAINT "FK_admin_account_monitoring_flags_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_admin_account_monitoring_flags_assigned_admin" FOREIGN KEY ("assigned_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_admin_account_monitoring_flags_created_by" FOREIGN KEY ("created_by_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_admin_account_monitoring_flags_resolved_by" FOREIGN KEY ("resolved_by_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_account_monitoring_status_review"
      ON "admin_account_monitoring_flags" (
        "status",
        "next_review_at" ASC NULLS LAST,
        "created_at" DESC,
        "id" DESC
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_account_monitoring_user_status"
      ON "admin_account_monitoring_flags" (
        "user_id",
        "status",
        "created_at" DESC,
        "id" DESC
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_account_monitoring_assigned_status"
      ON "admin_account_monitoring_flags" (
        "assigned_admin_id",
        "status",
        "next_review_at" ASC NULLS LAST
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_account_monitoring_signal_status"
      ON "admin_account_monitoring_flags" (
        "signal_type",
        "status",
        "created_at" DESC,
        "id" DESC
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_account_monitoring_active_unique"
      ON "admin_account_monitoring_flags" ("user_id", "signal_type")
      WHERE "status" IN ('open', 'watching')
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
      ADD VALUE IF NOT EXISTS 'account_monitoring_flag_created'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'account_monitoring_flag_updated'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'account_monitoring_flag_resolved'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_account_monitoring_active_unique"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_account_monitoring_signal_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_account_monitoring_assigned_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_account_monitoring_user_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_account_monitoring_status_review"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "admin_account_monitoring_flags"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "admin_account_monitoring_severity"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "admin_account_monitoring_status"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "admin_account_monitoring_signal_type"`,
    );
    // PostgreSQL enum values cannot be safely removed without recreating the type.
  }
}
