import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmartPickRetailerFreshness1717200000000 implements MigrationInterface {
  name = 'AddSmartPickRetailerFreshness1717200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        ADD COLUMN IF NOT EXISTS "retailer_data_checked_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "retailer_data_expires_at" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "smart_pick_product_suggestions"
      SET
        "retailer_data_checked_at" = COALESCE("retailer_data_checked_at", "created_at"),
        "retailer_data_expires_at" = COALESCE(
          "retailer_data_expires_at",
          "created_at" + interval '7 days'
        )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_smart_pick_product_suggestions_retailer_expires"
        ON "smart_pick_product_suggestions" ("retailer_data_expires_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_smart_pick_product_suggestions_retailer_expires"
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        DROP COLUMN IF EXISTS "retailer_data_expires_at",
        DROP COLUMN IF EXISTS "retailer_data_checked_at"
    `);
  }
}
