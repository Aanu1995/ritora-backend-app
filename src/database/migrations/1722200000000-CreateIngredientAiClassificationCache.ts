import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIngredientAiClassificationCache1722200000000 implements MigrationInterface {
  name = 'CreateIngredientAiClassificationCache1722200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ingredient_ai_classification_cache" (
        "cache_key" varchar(64) NOT NULL,
        "normalized_token" varchar(120) NOT NULL,
        "normalized_token_hash" varchar(64) NOT NULL,
        "model" varchar(120) NOT NULL,
        "contract_version" varchar(40) NOT NULL,
        "classification" jsonb NOT NULL,
        "confidence" numeric(4,3) NOT NULL,
        "category" varchar(32) NOT NULL,
        "overlap_severity" varchar(8) NOT NULL,
        "hit_count" integer NOT NULL DEFAULT 0,
        "expires_at" timestamptz NOT NULL,
        "last_used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingredient_ai_classification_cache" PRIMARY KEY ("cache_key")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ingredient_ai_classification_cache_token"
      ON "ingredient_ai_classification_cache" (
        "model",
        "contract_version",
        "normalized_token_hash"
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ingredient_ai_classification_cache_expires"
      ON "ingredient_ai_classification_cache" ("expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_ai_classification_cache_expires"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ingredient_ai_classification_cache_token"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ingredient_ai_classification_cache"`,
    );
  }
}
