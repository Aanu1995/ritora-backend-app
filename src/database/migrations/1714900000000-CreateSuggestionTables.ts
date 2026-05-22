import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema for the AI-powered, schedule-anchored suggestion engine.
 *
 *  - suggestion_instances: one per slot per calendar date (per the
 *    user's time zone). At most one non-superseded row per (user, slot,
 *    date). When a regenerate is requested, the prior row is moved to
 *    'superseded' and a new row is created with `supersedes_id` set.
 *  - suggestion_steps: ordered steps inside an instance. Carry the
 *    `provenance` flag so the UI can show 'Specialist locked', 'Your
 *    routine' and 'Added by AI' chips. Snapshot brand + name so that a
 *    deleted shelf product still renders correctly in history.
 *  - suggestion_generation_jobs: queue rows. The scheduler enqueues
 *    one job per slot per day at `visible_at` (slot_time minus the
 *    user's lead time). The worker claims jobs with a database-level
 *    UPDATE ... SKIP LOCKED.
 */
export class CreateSuggestionTables1714900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "suggestion_instances" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "slot_id" varchar(26),
        "target_date" date NOT NULL,
        "target_time" time NOT NULL,
        "daypart" varchar(10) NOT NULL,
        "mode" varchar(20) NOT NULL,
        "generation_status" varchar(20) NOT NULL DEFAULT 'pending',
        "visible_at" timestamptz NOT NULL,
        "generated_at" timestamptz,
        "ai_model" varchar(60),
        "ai_prompt_version" varchar(80),
        "ai_input_tokens" integer,
        "ai_output_tokens" integer,
        "ai_total_tokens" integer,
        "ai_estimated_cost_usd" double precision,
        "ai_duration_ms" integer,
        "ai_explanation" jsonb,
        "generation_context" jsonb,
        "gap_recommendations" jsonb,
        "safety_flags" jsonb,
        "has_reaction_signal" boolean NOT NULL DEFAULT false,
        "simplified_for_reaction" boolean NOT NULL DEFAULT false,
        "supersedes_id" varchar(26),
        "ai_error" text,
        "ai_retry_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suggestion_instances" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suggestion_instances_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_suggestion_instances_slot" FOREIGN KEY ("slot_id")
          REFERENCES "schedule_slots" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_suggestion_instances_supersedes" FOREIGN KEY ("supersedes_id")
          REFERENCES "suggestion_instances" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_suggestion_instances_daypart" CHECK (
          "daypart" IN ('morning','noon','evening')
        ),
        CONSTRAINT "CK_suggestion_instances_mode" CHECK (
          "mode" IN ('ai','manual','mixed')
        ),
        CONSTRAINT "CK_suggestion_instances_status" CHECK (
          "generation_status" IN (
            'pending','generating','ready','failed','superseded'
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_instances_user_target_date"
        ON "suggestion_instances" ("user_id", "target_date")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_instances_user_visible_at"
        ON "suggestion_instances" ("user_id", "visible_at")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_instances_user_slot_date_active"
        ON "suggestion_instances" ("user_id", "slot_id", "target_date")
        WHERE "generation_status" <> 'superseded' AND "slot_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "suggestion_steps" (
        "id" varchar(26) NOT NULL,
        "suggestion_instance_id" varchar(26) NOT NULL,
        "step_order" integer NOT NULL,
        "routine_step_id" varchar(26),
        "inventory_product_id" varchar(26),
        "product_brand_snapshot" varchar(255),
        "product_name_snapshot" varchar(255),
        "step_label" varchar(30) NOT NULL,
        "custom_label" varchar(100),
        "application_method" varchar(40),
        "quantity" varchar(40),
        "wait_after_minutes" integer,
        "explanation" text,
        "provenance" varchar(20) NOT NULL,
        "chips" jsonb,
        "safety_warnings" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suggestion_steps" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suggestion_steps_instance" FOREIGN KEY ("suggestion_instance_id")
          REFERENCES "suggestion_instances" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_suggestion_steps_routine_step" FOREIGN KEY ("routine_step_id")
          REFERENCES "routine_steps" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_suggestion_steps_product" FOREIGN KEY ("inventory_product_id")
          REFERENCES "inventory_products" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_suggestion_steps_provenance" CHECK (
          "provenance" IN ('specialist_locked','user_routine','ai_added')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_steps_instance_order"
        ON "suggestion_steps" ("suggestion_instance_id", "step_order")
    `);

    await queryRunner.query(`
      CREATE TABLE "suggestion_generation_jobs" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "slot_id" varchar(26) NOT NULL,
        "target_date" date NOT NULL,
        "target_time" time NOT NULL,
        "visible_at" timestamptz NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'queued',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "run_after" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" varchar(64),
        "last_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suggestion_generation_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suggestion_jobs_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_suggestion_jobs_slot" FOREIGN KEY ("slot_id")
          REFERENCES "schedule_slots" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_suggestion_jobs_status" CHECK (
          "status" IN ('queued','running','completed','failed','cancelled')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_jobs_status_run_after"
        ON "suggestion_generation_jobs" ("status", "run_after")
        WHERE "status" IN ('queued','running')
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_jobs_user_slot_date"
        ON "suggestion_generation_jobs" ("user_id", "slot_id", "target_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "suggestion_generation_jobs"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "suggestion_steps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "suggestion_instances"`);
  }
}
