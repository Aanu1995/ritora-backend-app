import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSuggestionTodayActionTables1715800000000 implements MigrationInterface {
  name = 'CreateSuggestionTodayActionTables1715800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "suggestion_reaction_overrides" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "target_date" date NOT NULL,
        "reaction_entry_id" varchar(26),
        "reason" varchar(40) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suggestion_reaction_overrides" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suggestion_reaction_overrides_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_suggestion_reaction_overrides_entry" FOREIGN KEY ("reaction_entry_id")
          REFERENCES "skin_journal_entries" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_suggestion_reaction_overrides_reason" CHECK (
          "reason" IN ('normal_routine_requested')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_reaction_overrides_user_date"
        ON "suggestion_reaction_overrides" ("user_id", "target_date")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_reaction_overrides_expires_at"
        ON "suggestion_reaction_overrides" ("expires_at")
    `);
    await queryRunner.query(`
      CREATE TABLE "suggestion_gap_actions" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "suggestion_instance_id" varchar(26) NOT NULL,
        "ingredient_or_category" varchar(160) NOT NULL,
        "normalized_key" varchar(180) NOT NULL,
        "action" varchar(20) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suggestion_gap_actions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suggestion_gap_actions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_suggestion_gap_actions_suggestion" FOREIGN KEY ("suggestion_instance_id")
          REFERENCES "suggestion_instances" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_suggestion_gap_actions_action" CHECK (
          "action" IN ('saved','dismissed')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_gap_actions_user_suggestion_key"
        ON "suggestion_gap_actions" (
          "user_id", "suggestion_instance_id", "normalized_key"
        )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_gap_actions_user_created"
        ON "suggestion_gap_actions" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE TABLE "suggestion_recording_reminder_snoozes" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "suggestion_instance_id" varchar(26) NOT NULL,
        "snoozed_until" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suggestion_recording_reminder_snoozes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suggestion_recording_snoozes_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_suggestion_recording_snoozes_suggestion" FOREIGN KEY ("suggestion_instance_id")
          REFERENCES "suggestion_instances" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_recording_snoozes_user_suggestion"
        ON "suggestion_recording_reminder_snoozes" (
          "user_id", "suggestion_instance_id"
        )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_recording_snoozes_until"
        ON "suggestion_recording_reminder_snoozes" ("snoozed_until")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "suggestion_recording_reminder_snoozes"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "suggestion_gap_actions"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "suggestion_reaction_overrides"`,
    );
  }
}
