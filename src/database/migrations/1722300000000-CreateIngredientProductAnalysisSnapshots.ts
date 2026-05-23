import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIngredientProductAnalysisSnapshots1722300000000 implements MigrationInterface {
  name = 'CreateIngredientProductAnalysisSnapshots1722300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ingredient_product_analysis_snapshots" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "product_id" varchar(26) NOT NULL,
        "language" varchar(5) NOT NULL,
        "with_explanations" boolean NOT NULL DEFAULT false,
        "product_updated_at" timestamptz NOT NULL,
        "inci_hash" varchar(64) NOT NULL,
        "engine_version" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "result" jsonb,
        "last_error" varchar(500),
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "analyzed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingredient_product_analysis_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ingredient_product_analysis_snapshots_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ingredient_product_analysis_snapshots_product"
          FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_ingredient_product_analysis_snapshot_unique"
      ON "ingredient_product_analysis_snapshots" (
        "user_id",
        "product_id",
        "language",
        "with_explanations"
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ingredient_product_analysis_snapshot_product"
      ON "ingredient_product_analysis_snapshots" ("product_id", "updated_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ingredient_product_analysis_snapshot_user_status"
      ON "ingredient_product_analysis_snapshots" ("user_id", "status", "updated_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_product_analysis_snapshot_user_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_product_analysis_snapshot_product"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_product_analysis_snapshot_unique"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ingredient_product_analysis_snapshots"`,
    );
  }
}
