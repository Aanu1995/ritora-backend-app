import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminOperationalIncidents1719700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'admin_operational_incident_status'
        ) THEN
          CREATE TYPE "admin_operational_incident_status" AS ENUM (
            'open',
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
          WHERE typname = 'admin_operational_incident_severity'
        ) THEN
          CREATE TYPE "admin_operational_incident_severity" AS ENUM (
            'warning',
            'critical'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_operational_incidents" (
        "id" varchar(26) NOT NULL,
        "title" varchar(160) NOT NULL,
        "description" text NOT NULL,
        "status" "admin_operational_incident_status" NOT NULL DEFAULT 'open',
        "severity" "admin_operational_incident_severity" NOT NULL,
        "source_type" varchar(80) NOT NULL,
        "source_id" varchar(120) NOT NULL,
        "target_user_id" varchar(26),
        "created_by_admin_id" varchar(26) NOT NULL,
        "resolved_by_admin_id" varchar(26),
        "resolved_at" timestamptz,
        "resolution_summary" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_operational_incidents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_admin_operational_incidents_created_by" FOREIGN KEY ("created_by_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_admin_operational_incidents_resolved_by" FOREIGN KEY ("resolved_by_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_admin_operational_incidents_target_user" FOREIGN KEY ("target_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_operational_incidents_status_created"
      ON "admin_operational_incidents" ("status", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_operational_incidents_source"
      ON "admin_operational_incidents" ("source_type", "source_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_operational_incidents_target_user"
      ON "admin_operational_incidents" ("target_user_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_operational_incidents_open_source"
      ON "admin_operational_incidents" ("source_type", "source_id")
      WHERE "status" = 'open'
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
            'user_note_created'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'operational_incident_created'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'operational_incident_resolved'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_operational_incidents_open_source"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_operational_incidents_target_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_operational_incidents_source"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_operational_incidents_status_created"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "admin_operational_incidents"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "admin_operational_incident_severity"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "admin_operational_incident_status"`,
    );
    // PostgreSQL enum values cannot be safely removed without recreating the type.
  }
}
