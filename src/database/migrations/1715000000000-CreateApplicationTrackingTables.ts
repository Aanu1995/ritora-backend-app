import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Routine application records.
 *
 *  - application_logs: one per (user, suggestion) when the user records
 *    what they actually applied. `has_been_edited`, `edit_count`, and
 *    `last_edited_at` drive the Edited pill in the UI. The first save
 *    creates a v1 row in application_log_versions; every subsequent
 *    save creates v2, v3, ... so the prior versions are never silently
 *    overwritten. This is the legal-protection record the mockup
 *    references.
 *  - application_log_items: per-step record. Status is one of applied,
 *    skipped, or substituted. Ad-hoc rows let the user record products
 *    not on shelf, or steps that were not in the suggestion.
 *  - application_log_versions: full snapshot per save.
 */
export class CreateApplicationTrackingTables1715000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "application_logs" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "suggestion_instance_id" varchar(26),
        "slot_id" varchar(26),
        "target_date" date NOT NULL,
        "target_time" time,
        "daypart" varchar(10),
        "applied_at" timestamptz,
        "general_notes" text,
        "edit_reason" text,
        "edit_count" integer NOT NULL DEFAULT 0,
        "has_been_edited" boolean NOT NULL DEFAULT false,
        "first_recorded_at" timestamptz NOT NULL DEFAULT now(),
        "last_edited_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_application_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_application_logs_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_logs_suggestion" FOREIGN KEY ("suggestion_instance_id")
          REFERENCES "suggestion_instances" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_application_logs_slot" FOREIGN KEY ("slot_id")
          REFERENCES "schedule_slots" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_application_logs_daypart" CHECK (
          "daypart" IS NULL OR "daypart" IN ('morning','noon','evening')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_application_logs_user_target_date"
        ON "application_logs" ("user_id", "target_date")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_application_logs_user_suggestion"
        ON "application_logs" ("user_id", "suggestion_instance_id")
        WHERE "suggestion_instance_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "application_log_items" (
        "id" varchar(26) NOT NULL,
        "application_log_id" varchar(26) NOT NULL,
        "step_order" integer NOT NULL,
        "suggestion_step_id" varchar(26),
        "inventory_product_id" varchar(26),
        "substituted_with_product_id" varchar(26),
        "product_brand_snapshot" varchar(255),
        "product_name_snapshot" varchar(255),
        "step_label" varchar(30),
        "status" varchar(20) NOT NULL,
        "is_ad_hoc" boolean NOT NULL DEFAULT false,
        "ad_hoc_brand" varchar(255),
        "ad_hoc_name" varchar(255),
        "notes" text,
        "applied_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_application_log_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_application_items_log" FOREIGN KEY ("application_log_id")
          REFERENCES "application_logs" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_items_suggestion_step" FOREIGN KEY ("suggestion_step_id")
          REFERENCES "suggestion_steps" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_application_items_product" FOREIGN KEY ("inventory_product_id")
          REFERENCES "inventory_products" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_application_items_sub_product" FOREIGN KEY ("substituted_with_product_id")
          REFERENCES "inventory_products" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_application_items_status" CHECK (
          "status" IN ('applied','skipped','substituted')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_application_items_log_order"
        ON "application_log_items" ("application_log_id", "step_order")
    `);

    await queryRunner.query(`
      CREATE TABLE "application_log_versions" (
        "id" varchar(26) NOT NULL,
        "application_log_id" varchar(26) NOT NULL,
        "version" integer NOT NULL,
        "snapshot" jsonb NOT NULL,
        "edited_by_user_id" varchar(26) NOT NULL,
        "edit_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_application_log_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_application_versions_log" FOREIGN KEY ("application_log_id")
          REFERENCES "application_logs" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_application_versions_user" FOREIGN KEY ("edited_by_user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_application_versions_log_version"
        ON "application_log_versions" ("application_log_id", "version")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_application_versions_log_created"
        ON "application_log_versions" ("application_log_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "application_log_versions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "application_log_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "application_logs"`);
  }
}
