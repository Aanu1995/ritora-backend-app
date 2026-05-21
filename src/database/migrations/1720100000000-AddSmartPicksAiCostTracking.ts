import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmartPicksAiCostTracking1720100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smart_pick_snapshots"
        ADD COLUMN IF NOT EXISTS "ai_model" varchar(80),
        ADD COLUMN IF NOT EXISTS "ai_input_tokens" integer,
        ADD COLUMN IF NOT EXISTS "ai_output_tokens" integer,
        ADD COLUMN IF NOT EXISTS "ai_total_tokens" integer,
        ADD COLUMN IF NOT EXISTS "ai_estimated_cost_usd" double precision
    `);

    await queryRunner.query(`
      ALTER TABLE "smart_pick_generation_jobs"
        ADD COLUMN IF NOT EXISTS "ai_model" varchar(80),
        ADD COLUMN IF NOT EXISTS "ai_input_tokens" integer,
        ADD COLUMN IF NOT EXISTS "ai_output_tokens" integer,
        ADD COLUMN IF NOT EXISTS "ai_total_tokens" integer,
        ADD COLUMN IF NOT EXISTS "ai_estimated_cost_usd" double precision
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_snapshots_generated_cost"
      ON "smart_pick_snapshots" ("generated_at")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_generation_jobs_updated_cost"
      ON "smart_pick_generation_jobs" ("updated_at")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_generation_jobs_updated_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_snapshots_generated_cost"`,
    );
    await queryRunner.query(`
      ALTER TABLE "smart_pick_generation_jobs"
        DROP COLUMN IF EXISTS "ai_estimated_cost_usd",
        DROP COLUMN IF EXISTS "ai_total_tokens",
        DROP COLUMN IF EXISTS "ai_output_tokens",
        DROP COLUMN IF EXISTS "ai_input_tokens",
        DROP COLUMN IF EXISTS "ai_model"
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_snapshots"
        DROP COLUMN IF EXISTS "ai_estimated_cost_usd",
        DROP COLUMN IF EXISTS "ai_total_tokens",
        DROP COLUMN IF EXISTS "ai_output_tokens",
        DROP COLUMN IF EXISTS "ai_input_tokens",
        DROP COLUMN IF EXISTS "ai_model"
    `);
  }
}
