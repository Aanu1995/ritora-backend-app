import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkinJournalInsightAiCostTracking1720400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "skin_journal_insight_generation_runs"
        ADD COLUMN IF NOT EXISTS "ai_model" varchar(80),
        ADD COLUMN IF NOT EXISTS "ai_input_tokens" integer,
        ADD COLUMN IF NOT EXISTS "ai_output_tokens" integer,
        ADD COLUMN IF NOT EXISTS "ai_total_tokens" integer,
        ADD COLUMN IF NOT EXISTS "ai_estimated_cost_usd" double precision
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_insight_runs_completed_cost"
      ON "skin_journal_insight_generation_runs" ("completed_at")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_insight_runs_completed_cost"`,
    );

    await queryRunner.query(`
      ALTER TABLE "skin_journal_insight_generation_runs"
        DROP COLUMN IF EXISTS "ai_estimated_cost_usd",
        DROP COLUMN IF EXISTS "ai_total_tokens",
        DROP COLUMN IF EXISTS "ai_output_tokens",
        DROP COLUMN IF EXISTS "ai_input_tokens",
        DROP COLUMN IF EXISTS "ai_model"
    `);
  }
}
