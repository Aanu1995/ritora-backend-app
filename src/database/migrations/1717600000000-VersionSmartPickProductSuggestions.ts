import { MigrationInterface, QueryRunner } from 'typeorm';

export class VersionSmartPickProductSuggestions1717600000000 implements MigrationInterface {
  name = 'VersionSmartPickProductSuggestions1717600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_smart_pick_product_suggestions_user_key"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_smart_pick_product_suggestions_user_key_hash"
        ON "smart_pick_product_suggestions" (
          "user_id", "normalized_key", "inputs_hash"
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_smart_pick_product_suggestions_user_key_hash"
    `);
    await queryRunner.query(`
      DELETE FROM "smart_pick_product_suggestions" stale
      USING (
        SELECT "id"
        FROM (
          SELECT
            "id",
            ROW_NUMBER() OVER (
              PARTITION BY "user_id", "normalized_key"
              ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
            ) AS row_number
          FROM "smart_pick_product_suggestions"
        ) ranked
        WHERE ranked.row_number > 1
      ) duplicate_rows
      WHERE stale."id" = duplicate_rows."id"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_smart_pick_product_suggestions_user_key"
        ON "smart_pick_product_suggestions" ("user_id", "normalized_key")
    `);
  }
}
