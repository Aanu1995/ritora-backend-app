import { MigrationInterface, QueryRunner } from 'typeorm';

const ACTIVE_JOB_STATUS_WHERE = `"status" IN ('queued','sent','running')`;

export class CreateIngredientProductAnalysisJobs1722400000000 implements MigrationInterface {
  name = 'CreateIngredientProductAnalysisJobs1722400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ingredient_product_analysis_jobs" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "product_id" varchar(26) NOT NULL,
        "language" varchar(5) NOT NULL,
        "with_explanations" boolean NOT NULL DEFAULT false,
        "inci_hash" varchar(64) NOT NULL,
        "product_updated_at" timestamptz NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'queued',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 3,
        "run_after" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" varchar(64),
        "last_error" varchar(500),
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingredient_product_analysis_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ingredient_product_analysis_jobs_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ingredient_product_analysis_jobs_product"
          FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ingredient_product_analysis_jobs_status_run_after"
      ON "ingredient_product_analysis_jobs" ("status", "run_after")
      WHERE ${ACTIVE_JOB_STATUS_WHERE}
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_ingredient_product_analysis_jobs_active_version"
      ON "ingredient_product_analysis_jobs" (
        "user_id",
        "product_id",
        "language",
        "with_explanations",
        "inci_hash",
        "product_updated_at"
      )
      WHERE ${ACTIVE_JOB_STATUS_WHERE}
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ingredient_product_analysis_jobs_product_updated"
      ON "ingredient_product_analysis_jobs" ("product_id", "updated_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_product_analysis_jobs_product_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_product_analysis_jobs_active_version"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_product_analysis_jobs_status_run_after"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ingredient_product_analysis_jobs"`,
    );
  }
}
