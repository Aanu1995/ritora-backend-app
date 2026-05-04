import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds richer suggestion context caching, source-of-truth application
 * item snapshots, and the extra indexes needed by Today/History reads.
 */
export class EnhanceSuggestionContextAndTracking1715400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "suggestion_context_cache" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "context_date" date NOT NULL,
        "cache_key" varchar(80) NOT NULL,
        "summary" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suggestion_context_cache" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suggestion_context_cache_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_context_cache_user_date"
        ON "suggestion_context_cache" ("user_id", "context_date")
    `);

    await queryRunner.query(`
      ALTER TABLE "application_log_items"
        ADD COLUMN "item_source" varchar(30) NOT NULL DEFAULT 'recommended',
        ADD COLUMN "substitution_reason" text,
        ADD COLUMN "recommended_snapshot" jsonb,
        ADD COLUMN "applied_snapshot" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "application_log_items"
        ADD CONSTRAINT "CK_application_items_source" CHECK (
          "item_source" IN ('recommended','added_shelf','added_off_shelf')
        )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_instances_user_slot_date"
        ON "suggestion_instances" ("user_id", "slot_id", "target_date")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_application_logs_user_slot_date"
        ON "application_logs" ("user_id", "slot_id", "target_date")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_entries_user_reaction_date"
        ON "skin_journal_entries" ("user_id", "has_reaction_signal", "entry_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_skin_journal_entries_user_reaction_date"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_application_logs_user_slot_date"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_suggestion_instances_user_slot_date"
    `);
    await queryRunner.query(`
      ALTER TABLE "application_log_items"
        DROP CONSTRAINT IF EXISTS "CK_application_items_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "application_log_items"
        DROP COLUMN IF EXISTS "applied_snapshot",
        DROP COLUMN IF EXISTS "recommended_snapshot",
        DROP COLUMN IF EXISTS "substitution_reason",
        DROP COLUMN IF EXISTS "item_source"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "suggestion_context_cache"`);
  }
}
