import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSkinJournalTables1714200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "skin_journal_entries" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "entry_date" date NOT NULL,
        "time_zone" varchar(64) NOT NULL,
        "photo_object_key" text,
        "photo_width" integer,
        "photo_height" integer,
        "photo_size" integer,
        "photo_content_type" varchar(40),
        "exif_stripped" boolean NOT NULL DEFAULT false,
        "angle" varchar(20) NOT NULL DEFAULT 'head_on',
        "concern_focus" jsonb,
        "is_pre_routine" boolean NOT NULL DEFAULT true,
        "ratings" jsonb,
        "overall_feel" varchar(20),
        "sleep_band" varchar(20),
        "stress_today" varchar(20),
        "sun_exposure_today" varchar(20),
        "sweat_exercise_today" boolean,
        "cycle_marker" varchar(20),
        "recent_change" jsonb,
        "complaint_note" text,
        "analysis_status" varchar(20) NOT NULL DEFAULT 'pending',
        "analysis_observations" jsonb,
        "analysis_summary" text,
        "analysis_model" varchar(60),
        "analysis_version" varchar(20),
        "analysis_error" text,
        "analysis_completed_at" timestamptz,
        "analysis_retry_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skin_journal_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_skin_journal_entries_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_skin_journal_entries_user_date" UNIQUE ("user_id", "entry_date"),
        CONSTRAINT "CK_skin_journal_entries_angle" CHECK (
          "angle" IN ('head_on','left_profile','right_profile')
        ),
        CONSTRAINT "CK_skin_journal_entries_status" CHECK (
          "analysis_status" IN ('pending','queued','running','completed','failed','needs_review','skipped')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_entries_user_date_desc"
        ON "skin_journal_entries" ("user_id", "entry_date" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "skin_journal_events" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "entry_id" varchar(26) NOT NULL,
        "kind" varchar(40) NOT NULL,
        "severity" varchar(20) NOT NULL DEFAULT 'info',
        "payload" jsonb,
        "acknowledged_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skin_journal_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_skin_journal_events_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_skin_journal_events_entry" FOREIGN KEY ("entry_id")
          REFERENCES "skin_journal_entries" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_skin_journal_events_kind" CHECK (
          "kind" IN ('reaction_detected','worsening','recovery','dermatologist_referral','product_effectiveness')
        ),
        CONSTRAINT "CK_skin_journal_events_severity" CHECK (
          "severity" IN ('info','warning','critical')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_events_user_kind_ack"
        ON "skin_journal_events" ("user_id", "kind", "acknowledged_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_events_user_ack_severity"
        ON "skin_journal_events" ("user_id", "acknowledged_at", "severity")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_events_user_unack_warning"
        ON "skin_journal_events" ("user_id")
        WHERE "acknowledged_at" IS NULL
          AND "severity" IN ('warning','critical')
    `);

    await queryRunner.query(`
      CREATE TABLE "skin_journal_insights" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "generated_at" timestamptz NOT NULL DEFAULT now(),
        "kind" varchar(40) NOT NULL,
        "summary" text,
        "supporting_data" jsonb,
        "related_entry_ids" jsonb,
        "severity" varchar(20) NOT NULL DEFAULT 'info',
        "seen_at" timestamptz,
        "dismissed_at" timestamptz,
        CONSTRAINT "PK_skin_journal_insights" PRIMARY KEY ("id"),
        CONSTRAINT "FK_skin_journal_insights_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_skin_journal_insights_kind" CHECK (
          "kind" IN ('daily','weekly','monthly','trend','correlation','effectiveness','reaction_recovery','referral')
        ),
        CONSTRAINT "CK_skin_journal_insights_severity" CHECK (
          "severity" IN ('info','warning','critical')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_insights_user_kind_dismissed"
        ON "skin_journal_insights" ("user_id", "kind", "dismissed_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "skin_journal_wrapped" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "period_kind" varchar(20) NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "status" varchar(30) NOT NULL DEFAULT 'pending',
        "manifest" jsonb,
        "media_object_key" text,
        "error" text,
        "generated_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skin_journal_wrapped" PRIMARY KEY ("id"),
        CONSTRAINT "FK_skin_journal_wrapped_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_skin_journal_wrapped_period" CHECK (
          "period_kind" IN ('monthly','quarterly','yearly')
        ),
        CONSTRAINT "CK_skin_journal_wrapped_status" CHECK (
          "status" IN ('not_enough_photos','ready_to_generate','pending','generating','ready','failed')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_wrapped_user_period"
        ON "skin_journal_wrapped" ("user_id", "period_kind", "period_start" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "routine_simplification_events" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "triggered_by_event_id" varchar(26),
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "ended_at" timestamptz,
        "original_schedule_snapshot" jsonb,
        "simplification_mode" varchar(40) NOT NULL DEFAULT 'barrier_repair',
        "reason" text,
        "acknowledged_at" timestamptz,
        "restore_strategy" varchar(20) NOT NULL DEFAULT 'full',
        CONSTRAINT "PK_routine_simplification_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_simplification_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_simplification_event" FOREIGN KEY ("triggered_by_event_id")
          REFERENCES "skin_journal_events" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_simplification_mode" CHECK (
          "simplification_mode" IN ('barrier_repair')
        ),
        CONSTRAINT "CK_simplification_strategy" CHECK (
          "restore_strategy" IN ('full','phased')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_simplification_active"
        ON "routine_simplification_events" ("user_id")
        WHERE "ended_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_simplification_user_unack_active"
        ON "routine_simplification_events" ("user_id")
        WHERE "ended_at" IS NULL
          AND "acknowledged_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "skin_journal_export_jobs" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "range_from" date NOT NULL,
        "range_to" date NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'ready',
        "payload" jsonb,
        "error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skin_journal_export_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_skin_journal_export_jobs_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_skin_journal_export_jobs_status" CHECK (
          "status" IN ('ready','failed')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_export_jobs_user_created"
        ON "skin_journal_export_jobs" ("user_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "skin_journal_export_jobs"`);
    await queryRunner.query(`DROP TABLE "routine_simplification_events"`);
    await queryRunner.query(`DROP TABLE "skin_journal_wrapped"`);
    await queryRunner.query(`DROP TABLE "skin_journal_insights"`);
    await queryRunner.query(`DROP TABLE "skin_journal_events"`);
    await queryRunner.query(`DROP TABLE "skin_journal_entries"`);
  }
}
