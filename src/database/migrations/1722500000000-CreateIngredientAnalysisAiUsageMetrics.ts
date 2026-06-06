import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIngredientAnalysisAiUsageMetrics1722500000000 implements MigrationInterface {
  name = 'CreateIngredientAnalysisAiUsageMetrics1722500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ingredient_analysis_ai_usage_metrics" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26),
        "product_id" varchar(26),
        "source" varchar(60) NOT NULL,
        "operation" varchar(40) NOT NULL,
        "status" varchar(20) NOT NULL,
        "model" varchar(80),
        "input_tokens" integer,
        "output_tokens" integer,
        "total_tokens" integer,
        "ai_estimated_cost_usd" double precision,
        "duration_ms" integer NOT NULL DEFAULT 0,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingredient_analysis_ai_usage_metrics" PRIMARY KEY ("id"),
        CONSTRAINT "chk_ingredient_analysis_ai_usage_metrics_operation"
          CHECK ("operation" IN ('classification', 'explanation')),
        CONSTRAINT "chk_ingredient_analysis_ai_usage_metrics_status"
          CHECK ("status" IN ('completed', 'failed')),
        CONSTRAINT "chk_ingredient_analysis_ai_usage_metrics_cost"
          CHECK ("ai_estimated_cost_usd" IS NULL OR "ai_estimated_cost_usd" >= 0),
        CONSTRAINT "chk_ingredient_analysis_ai_usage_metrics_tokens"
          CHECK (
            ("input_tokens" IS NULL OR "input_tokens" >= 0)
            AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
            AND ("total_tokens" IS NULL OR "total_tokens" >= 0)
          ),
        CONSTRAINT "chk_ingredient_analysis_ai_usage_metrics_duration"
          CHECK ("duration_ms" >= 0)
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'fk_ingredient_analysis_ai_usage_metrics_user'
        ) THEN
          ALTER TABLE "ingredient_analysis_ai_usage_metrics"
            ADD CONSTRAINT "fk_ingredient_analysis_ai_usage_metrics_user"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'fk_ingredient_analysis_ai_usage_metrics_product'
        ) THEN
          ALTER TABLE "ingredient_analysis_ai_usage_metrics"
            ADD CONSTRAINT "fk_ingredient_analysis_ai_usage_metrics_product"
            FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ingredient_analysis_ai_usage_metrics_user_cost"
      ON "ingredient_analysis_ai_usage_metrics" ("user_id", "occurred_at" DESC)
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "user_id" IS NOT NULL
        AND "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ingredient_analysis_ai_usage_metrics_cost_time"
      ON "ingredient_analysis_ai_usage_metrics" ("occurred_at" DESC, "user_id")
      INCLUDE ("ai_estimated_cost_usd")
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ingredient_analysis_ai_usage_metrics_status_time"
      ON "ingredient_analysis_ai_usage_metrics" ("status", "occurred_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_analysis_ai_usage_metrics_status_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_analysis_ai_usage_metrics_cost_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_analysis_ai_usage_metrics_user_cost"`,
    );
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "ingredient_analysis_ai_usage_metrics" DROP CONSTRAINT IF EXISTS "fk_ingredient_analysis_ai_usage_metrics_product"`,
    );
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "ingredient_analysis_ai_usage_metrics" DROP CONSTRAINT IF EXISTS "fk_ingredient_analysis_ai_usage_metrics_user"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ingredient_analysis_ai_usage_metrics"`,
    );
  }
}
