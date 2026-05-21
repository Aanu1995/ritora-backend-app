import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductCheckAiReviewMetricUser1720600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_check_ai_review_metrics"
        ADD COLUMN IF NOT EXISTS "user_id" varchar(26)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_product_check_ai_review_metrics_user'
        ) THEN
          ALTER TABLE "product_check_ai_review_metrics"
            ADD CONSTRAINT "fk_product_check_ai_review_metrics_user"
            FOREIGN KEY ("user_id")
            REFERENCES "users"("id")
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_check_ai_review_metrics_user_cost"
      ON "product_check_ai_review_metrics" ("user_id", "occurred_at" DESC)
      WHERE "user_id" IS NOT NULL
        AND "ai_estimated_cost_usd" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_check_ai_review_metrics_user_cost"`,
    );
    await queryRunner.query(`
      ALTER TABLE "product_check_ai_review_metrics"
        DROP CONSTRAINT IF EXISTS "fk_product_check_ai_review_metrics_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "product_check_ai_review_metrics"
        DROP COLUMN IF EXISTS "user_id"
    `);
  }
}
