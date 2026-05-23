import { MigrationInterface, QueryRunner } from 'typeorm';

const NOTIFICATION_KINDS_WITH_COMMUNITY = `
  'photo_reminder','reaction_detected','simplification_started',
  'doctor_referral','insight_ready','wrapped_ready','analysis_failed',
  'export_ready','suggestion_ready','slot_start','recording_reminder',
  'product_nearing_expiry','product_expired','smart_pick_ready',
  'community_moderation'
`;

const NOTIFICATION_KINDS_WITHOUT_COMMUNITY = `
  'photo_reminder','reaction_detected','simplification_started',
  'doctor_referral','insight_ready','wrapped_ready','analysis_failed',
  'export_ready','suggestion_ready','slot_start','recording_reminder',
  'product_nearing_expiry','product_expired','smart_pick_ready'
`;

export class CreateCommunityTables1722100000000 implements MigrationInterface {
  name = 'CreateCommunityTables1722100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'community_content_moderated'
    `);
    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'community_report_updated'
    `);
    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'community_warning_updated'
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP CONSTRAINT IF EXISTS "CK_in_app_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITH_COMMUNITY})
        )
    `);

    await queryRunner.query(`
      CREATE TABLE "community_profiles" (
        "id" varchar(26) PRIMARY KEY,
        "user_id" varchar(26) NOT NULL,
        "display_name" varchar(80) NOT NULL,
        "safe_facets" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_community_profiles_user" ON "community_profiles" ("user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_routines" (
        "id" varchar(26) PRIMARY KEY,
        "author_user_id" varchar(26) NOT NULL,
        "community_profile_id" varchar(26) NOT NULL,
        "title" varchar(120) NOT NULL,
        "summary" varchar(500),
        "concern_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "goal_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "disclosure_type" varchar(30) NOT NULL,
        "moderation_status" varchar(30) NOT NULL,
        "assigned_admin_id" varchar(26),
        "safe_facets" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "safety_flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "helpful_count" integer NOT NULL DEFAULT 0,
        "not_helpful_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_community_routines_status_updated" ON "community_routines" ("moderation_status", "updated_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_community_routines_author_created" ON "community_routines" ("author_user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_community_routines_assigned_admin" ON "community_routines" ("assigned_admin_id", "updated_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_routine_steps" (
        "id" varchar(26) PRIMARY KEY,
        "routine_id" varchar(26) NOT NULL,
        "step_order" integer NOT NULL,
        "slot" varchar(10) NOT NULL,
        "product_id" varchar(26),
        "product_brand" varchar(255),
        "product_name" varchar(255),
        "category" varchar(40) NOT NULL,
        "frequency" varchar(80),
        "notes" varchar(500)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_community_routine_steps_routine_order" ON "community_routine_steps" ("routine_id", "step_order")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_reviews" (
        "id" varchar(26) PRIMARY KEY,
        "author_user_id" varchar(26) NOT NULL,
        "community_profile_id" varchar(26) NOT NULL,
        "product_id" varchar(26),
        "product_brand" varchar(255) NOT NULL,
        "product_name" varchar(255) NOT NULL,
        "product_category" varchar(40) NOT NULL,
        "disclosure_type" varchar(30) NOT NULL,
        "usage_duration" varchar(30) NOT NULL,
        "frequency" varchar(50) NOT NULL,
        "outcomes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "repurchase" varchar(30) NOT NULL,
        "body" varchar(1200),
        "moderation_status" varchar(30) NOT NULL,
        "assigned_admin_id" varchar(26),
        "safe_facets" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "safety_flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "helpful_count" integer NOT NULL DEFAULT 0,
        "not_helpful_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_community_reviews_status_updated" ON "community_reviews" ("moderation_status", "updated_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_community_reviews_product_status" ON "community_reviews" ("product_id", "moderation_status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_community_reviews_assigned_admin" ON "community_reviews" ("assigned_admin_id", "updated_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_review_context_products" (
        "id" varchar(26) PRIMARY KEY,
        "review_id" varchar(26) NOT NULL,
        "product_id" varchar(26),
        "product_brand" varchar(255),
        "product_name" varchar(255),
        "category" varchar(40) NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_community_review_context_review" ON "community_review_context_products" ("review_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_reports" (
        "id" varchar(26) PRIMARY KEY,
        "reporter_user_id" varchar(26) NOT NULL,
        "content_type" varchar(20) NOT NULL,
        "content_id" varchar(26) NOT NULL,
        "reason" varchar(40) NOT NULL,
        "note" varchar(1000),
        "status" varchar(20) NOT NULL DEFAULT 'open',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_community_reports_status_created" ON "community_reports" ("status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_community_reports_content" ON "community_reports" ("content_type", "content_id")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_community_reports_open_reporter_content"
      ON "community_reports" ("reporter_user_id", "content_type", "content_id")
      WHERE "status" IN ('open', 'triaged')
    `);

    await queryRunner.query(`
      CREATE TABLE "community_moderation_decisions" (
        "id" varchar(26) PRIMARY KEY,
        "content_type" varchar(20) NOT NULL,
        "content_id" varchar(26) NOT NULL,
        "actor_admin_id" varchar(26),
        "from_status" varchar(30) NOT NULL,
        "to_status" varchar(30) NOT NULL,
        "reason" varchar(500) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_community_moderation_content_created" ON "community_moderation_decisions" ("content_type", "content_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_helpfulness_votes" (
        "id" varchar(26) PRIMARY KEY,
        "user_id" varchar(26) NOT NULL,
        "content_type" varchar(20) NOT NULL,
        "content_id" varchar(26) NOT NULL,
        "vote" varchar(20) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_community_helpfulness_unique" ON "community_helpfulness_votes" ("user_id", "content_type", "content_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_safety_scan_results" (
        "id" varchar(26) PRIMARY KEY,
        "content_type" varchar(20) NOT NULL,
        "content_id" varchar(26) NOT NULL,
        "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_community_safety_scan_content_created" ON "community_safety_scan_results" ("content_type", "content_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_routine_adaptations" (
        "id" varchar(26) PRIMARY KEY,
        "user_id" varchar(26) NOT NULL,
        "routine_id" varchar(26) NOT NULL,
        "changes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "saved" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_community_adaptations_user_created" ON "community_routine_adaptations" ("user_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_warnings" (
        "id" varchar(26) PRIMARY KEY,
        "title" varchar(160) NOT NULL,
        "body" varchar(1000) NOT NULL,
        "severity" varchar(20) NOT NULL,
        "affected_facets" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_community_warnings_active_severity" ON "community_warnings" ("active", "severity", "updated_at")`,
    );

    await queryRunner.query(`
      ALTER TABLE "community_profiles"
      ADD CONSTRAINT "FK_community_profiles_user"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routines"
      ADD CONSTRAINT "FK_community_routines_author"
      FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routines"
      ADD CONSTRAINT "FK_community_routines_profile"
      FOREIGN KEY ("community_profile_id") REFERENCES "community_profiles" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routines"
      ADD CONSTRAINT "FK_community_routines_assigned_admin"
      FOREIGN KEY ("assigned_admin_id") REFERENCES "admin_accounts" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routine_steps"
      ADD CONSTRAINT "FK_community_routine_steps_routine"
      FOREIGN KEY ("routine_id") REFERENCES "community_routines" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routine_steps"
      ADD CONSTRAINT "FK_community_routine_steps_product"
      FOREIGN KEY ("product_id") REFERENCES "inventory_products" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
      ADD CONSTRAINT "FK_community_reviews_author"
      FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
      ADD CONSTRAINT "FK_community_reviews_profile"
      FOREIGN KEY ("community_profile_id") REFERENCES "community_profiles" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
      ADD CONSTRAINT "FK_community_reviews_product"
      FOREIGN KEY ("product_id") REFERENCES "inventory_products" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
      ADD CONSTRAINT "FK_community_reviews_assigned_admin"
      FOREIGN KEY ("assigned_admin_id") REFERENCES "admin_accounts" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "community_review_context_products"
      ADD CONSTRAINT "FK_community_review_context_review"
      FOREIGN KEY ("review_id") REFERENCES "community_reviews" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_review_context_products"
      ADD CONSTRAINT "FK_community_review_context_product"
      FOREIGN KEY ("product_id") REFERENCES "inventory_products" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reports"
      ADD CONSTRAINT "FK_community_reports_reporter"
      FOREIGN KEY ("reporter_user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_moderation_decisions"
      ADD CONSTRAINT "FK_community_moderation_actor"
      FOREIGN KEY ("actor_admin_id") REFERENCES "admin_accounts" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "community_helpfulness_votes"
      ADD CONSTRAINT "FK_community_helpfulness_user"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routine_adaptations"
      ADD CONSTRAINT "FK_community_adaptations_user"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routine_adaptations"
      ADD CONSTRAINT "FK_community_adaptations_routine"
      FOREIGN KEY ("routine_id") REFERENCES "community_routines" ("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP CONSTRAINT IF EXISTS "CK_in_app_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITHOUT_COMMUNITY})
        )
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_warnings_active_severity"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "community_warnings"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_adaptations_user_created"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "community_routine_adaptations"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_safety_scan_content_created"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "community_safety_scan_results"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_helpfulness_unique"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "community_helpfulness_votes"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_moderation_content_created"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "community_moderation_decisions"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_reports_content"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_reports_status_created"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_reports_open_reporter_content"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "community_reports"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_review_context_review"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "community_review_context_products"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_reviews_product_status"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_reviews_status_updated"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_reviews_assigned_admin"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "community_reviews"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_routine_steps_routine_order"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "community_routine_steps"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_routines_author_created"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_routines_status_updated"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_routines_assigned_admin"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "community_routines"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_profiles_user"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "community_profiles"');
  }
}
