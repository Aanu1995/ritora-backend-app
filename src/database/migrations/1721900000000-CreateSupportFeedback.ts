import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupportFeedback1721900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'support_feedback_source'
        ) THEN
          CREATE TYPE "support_feedback_source" AS ENUM (
            'user_web_app',
            'support_email',
            'app_store_review',
            'admin_created',
            'other'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'support_feedback_type'
        ) THEN
          CREATE TYPE "support_feedback_type" AS ENUM (
            'bug',
            'suggestion',
            'confusing_result',
            'unsafe_recommendation',
            'product_data_issue',
            'billing_pricing',
            'account',
            'other'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'support_feedback_status'
        ) THEN
          CREATE TYPE "support_feedback_status" AS ENUM (
            'new',
            'triaged',
            'planned',
            'fixed',
            'closed'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'support_feedback_priority'
        ) THEN
          CREATE TYPE "support_feedback_priority" AS ENUM (
            'low',
            'medium',
            'high',
            'critical'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_feedback_items" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26),
        "reporter_email" varchar(320),
        "source" "support_feedback_source" NOT NULL,
        "type" "support_feedback_type" NOT NULL,
        "status" "support_feedback_status" NOT NULL DEFAULT 'new',
        "priority" "support_feedback_priority" NOT NULL DEFAULT 'medium',
        "title" varchar(160) NOT NULL,
        "description" text NOT NULL,
        "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "assigned_admin_id" varchar(26),
        "created_by_admin_id" varchar(26),
        "closed_by_admin_id" varchar(26),
        "closed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_feedback_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_support_feedback_items_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_support_feedback_items_assigned_admin" FOREIGN KEY ("assigned_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_support_feedback_items_created_by_admin" FOREIGN KEY ("created_by_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_support_feedback_items_closed_by_admin" FOREIGN KEY ("closed_by_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_feedback_notes" (
        "id" varchar(26) NOT NULL,
        "feedback_id" varchar(26) NOT NULL,
        "author_admin_id" varchar(26) NOT NULL,
        "body" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_feedback_notes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_support_feedback_notes_feedback" FOREIGN KEY ("feedback_id")
          REFERENCES "support_feedback_items" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_support_feedback_notes_author_admin" FOREIGN KEY ("author_admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_status_priority_updated"
      ON "support_feedback_items" ("status", "priority", "updated_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_assigned_status_updated"
      ON "support_feedback_items" ("assigned_admin_id", "status", "updated_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_user_status_updated"
      ON "support_feedback_items" ("user_id", "status", "updated_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_type_status_updated"
      ON "support_feedback_items" ("type", "status", "updated_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_reporter_email"
      ON "support_feedback_items" (LOWER("reporter_email"))
      WHERE "reporter_email" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_notes_feedback_created"
      ON "support_feedback_notes" ("feedback_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_notes_author_created"
      ON "support_feedback_notes" ("author_admin_id", "created_at" DESC, "id" DESC)
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
      ADD VALUE IF NOT EXISTS 'support_feedback_created'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'support_feedback_updated'
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'support_feedback_note_created'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_feedback_notes_author_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_feedback_notes_feedback_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_feedback_reporter_email"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_feedback_type_status_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_feedback_user_status_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_feedback_assigned_status_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_feedback_status_priority_updated"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "support_feedback_notes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_feedback_items"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "support_feedback_priority"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "support_feedback_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "support_feedback_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "support_feedback_source"`);
    // PostgreSQL enum values cannot be safely removed without recreating the type.
  }
}
