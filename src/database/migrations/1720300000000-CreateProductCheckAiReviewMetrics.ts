import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductCheckAiReviewMetrics1720300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_check_ai_review_metrics" (
        "id" varchar(26) PRIMARY KEY,
        "product_source" varchar(40) NOT NULL,
        "status" varchar(32) NOT NULL,
        "model" varchar(80),
        "input_tokens" integer,
        "output_tokens" integer,
        "total_tokens" integer,
        "ai_estimated_cost_usd" double precision,
        "duration_ms" integer NOT NULL,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_product_check_ai_review_metrics_source"
          CHECK ("product_source" IN ('ingredient_paste', 'photo_extraction')),
        CONSTRAINT "chk_product_check_ai_review_metrics_status"
          CHECK ("status" IN ('reviewed', 'unavailable')),
        CONSTRAINT "chk_product_check_ai_review_metrics_cost"
          CHECK ("ai_estimated_cost_usd" IS NULL OR "ai_estimated_cost_usd" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_check_ai_review_metrics_occurred"
      ON "product_check_ai_review_metrics" ("occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_check_ai_review_metrics_status_time"
      ON "product_check_ai_review_metrics" ("status", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_check_ai_review_metrics_source_time"
      ON "product_check_ai_review_metrics" ("product_source", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_check_ai_review_metrics_cost"
      ON "product_check_ai_review_metrics" ("occurred_at" DESC)
      WHERE "ai_estimated_cost_usd" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_check_ai_review_metrics_cost"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_check_ai_review_metrics_source_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_check_ai_review_metrics_status_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_check_ai_review_metrics_occurred"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "product_check_ai_review_metrics"`,
    );
  }
}
