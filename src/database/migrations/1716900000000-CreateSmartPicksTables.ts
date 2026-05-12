import { MigrationInterface, QueryRunner } from 'typeorm';

const NOTIFICATION_KINDS_WITH_SMART_PICKS = `
  'photo_reminder','reaction_detected','simplification_started',
  'doctor_referral','insight_ready','wrapped_ready','analysis_failed',
  'export_ready','suggestion_ready','slot_start','recording_reminder',
  'product_nearing_expiry','product_expired','smart_pick_ready'
`;

const NOTIFICATION_KINDS_WITHOUT_SMART_PICKS = `
  'photo_reminder','reaction_detected','simplification_started',
  'doctor_referral','insight_ready','wrapped_ready','analysis_failed',
  'export_ready','suggestion_ready','slot_start','recording_reminder',
  'product_nearing_expiry','product_expired'
`;

export class CreateSmartPicksTables1716900000000 implements MigrationInterface {
  name = 'CreateSmartPicksTables1716900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "smart_pick_snapshots" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "mode" varchar(16) NOT NULL,
        "coverage_json" jsonb NOT NULL,
        "gaps_json" jsonb NOT NULL,
        "covered_json" jsonb NOT NULL,
        "redundancy_json" jsonb NOT NULL,
        "recap_json" jsonb NOT NULL,
        "inputs_hash" varchar(64) NOT NULL,
        "generated_at" timestamptz NOT NULL,
        "expires_at" timestamptz NOT NULL,
        CONSTRAINT "PK_smart_pick_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_smart_pick_snapshots_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_smart_pick_snapshots_mode" CHECK (
          "mode" IN ('refine','starter')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_smart_pick_snapshots_user"
        ON "smart_pick_snapshots" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_smart_pick_snapshots_expires_at"
        ON "smart_pick_snapshots" ("expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "smart_pick_product_suggestions" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "ingredient_or_category" varchar(160) NOT NULL,
        "normalized_key" varchar(180) NOT NULL,
        "brand" varchar(120) NOT NULL,
        "product_name" varchar(200) NOT NULL,
        "budget_tier" varchar(20),
        "price_cents" integer,
        "currency" varchar(3),
        "retailers_json" jsonb NOT NULL,
        "reasoning_chips_json" jsonb NOT NULL,
        "reasoning_facts_json" jsonb NOT NULL,
        "ruled_out_json" jsonb NOT NULL,
        "alternatives_json" jsonb NOT NULL,
        "source_ids" text[] NOT NULL DEFAULT '{}',
        "verification_status" varchar(20) NOT NULL DEFAULT 'ai_named',
        "inputs_hash" varchar(64) NOT NULL,
        "gap_reason" text,
        "goal_alignment" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_pick_product_suggestions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_smart_pick_product_suggestions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_smart_pick_product_suggestions_budget_tier" CHECK (
          "budget_tier" IS NULL OR "budget_tier" IN ('drugstore','mid','premium','luxury')
        ),
        CONSTRAINT "CK_smart_pick_product_suggestions_verification" CHECK (
          "verification_status" IN ('ai_named','unavailable')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_smart_pick_product_suggestions_user_key"
        ON "smart_pick_product_suggestions" ("user_id", "normalized_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_smart_pick_product_suggestions_user_created"
        ON "smart_pick_product_suggestions" ("user_id", "created_at")
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_gap_actions_user_suggestion_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        ADD COLUMN "source_type" varchar(20) NOT NULL DEFAULT 'today',
        ADD COLUMN "smart_pick_product_suggestion_id" varchar(26)
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        ALTER COLUMN "suggestion_instance_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        ADD CONSTRAINT "FK_suggestion_gap_actions_smart_pick_product"
        FOREIGN KEY ("smart_pick_product_suggestion_id")
        REFERENCES "smart_pick_product_suggestions" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        ADD CONSTRAINT "CK_suggestion_gap_actions_source_type" CHECK (
          "source_type" IN ('today','smart_pick')
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        ADD CONSTRAINT "CK_suggestion_gap_actions_source_target" CHECK (
          (
            "source_type" = 'today'
            AND "suggestion_instance_id" IS NOT NULL
            AND "smart_pick_product_suggestion_id" IS NULL
          )
          OR
          (
            "source_type" = 'smart_pick'
            AND "suggestion_instance_id" IS NULL
            AND "smart_pick_product_suggestion_id" IS NOT NULL
          )
        )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_gap_actions_today_user_suggestion_key"
        ON "suggestion_gap_actions" (
          "user_id", "suggestion_instance_id", "normalized_key"
        )
        WHERE "source_type" = 'today' AND "suggestion_instance_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_gap_actions_smart_pick_user_suggestion_key"
        ON "suggestion_gap_actions" (
          "user_id", "smart_pick_product_suggestion_id", "normalized_key"
        )
        WHERE "source_type" = 'smart_pick'
          AND "smart_pick_product_suggestion_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_gap_actions_user_source_action"
        ON "suggestion_gap_actions" ("user_id", "source_type", "action")
    `);

    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        ADD COLUMN "smart_pick_ready_enabled" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP CONSTRAINT IF EXISTS "CK_in_app_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITH_SMART_PICKS})
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "scheduled_notifications"
        DROP CONSTRAINT IF EXISTS "CK_scheduled_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "scheduled_notifications"
        ADD CONSTRAINT "CK_scheduled_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITH_SMART_PICKS})
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "scheduled_notifications" WHERE "kind" = 'smart_pick_ready'
    `);
    await queryRunner.query(`
      DELETE FROM "in_app_notifications" WHERE "kind" = 'smart_pick_ready'
    `);
    await queryRunner.query(`
      ALTER TABLE "scheduled_notifications"
        DROP CONSTRAINT IF EXISTS "CK_scheduled_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "scheduled_notifications"
        ADD CONSTRAINT "CK_scheduled_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITHOUT_SMART_PICKS})
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP CONSTRAINT IF EXISTS "CK_in_app_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITHOUT_SMART_PICKS})
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        DROP COLUMN IF EXISTS "smart_pick_ready_enabled"
    `);

    await queryRunner.query(`
      DELETE FROM "suggestion_gap_actions" WHERE "source_type" = 'smart_pick'
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_suggestion_gap_actions_user_source_action"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_gap_actions_smart_pick_user_suggestion_key"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_gap_actions_today_user_suggestion_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        DROP CONSTRAINT IF EXISTS "CK_suggestion_gap_actions_source_target"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        DROP CONSTRAINT IF EXISTS "CK_suggestion_gap_actions_source_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        DROP CONSTRAINT IF EXISTS "FK_suggestion_gap_actions_smart_pick_product"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        DROP COLUMN IF EXISTS "smart_pick_product_suggestion_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        ALTER COLUMN "suggestion_instance_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_gap_actions"
        DROP COLUMN IF EXISTS "source_type"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_gap_actions_user_suggestion_key"
        ON "suggestion_gap_actions" (
          "user_id", "suggestion_instance_id", "normalized_key"
        )
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "smart_pick_product_suggestions"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "smart_pick_snapshots"`);
  }
}
