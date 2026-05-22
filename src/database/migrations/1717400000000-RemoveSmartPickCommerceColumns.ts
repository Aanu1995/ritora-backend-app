import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveSmartPickCommerceColumns1717400000000 implements MigrationInterface {
  name = 'RemoveSmartPickCommerceColumns1717400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "suggestion_gap_actions"
      WHERE "source_type" = 'smart_pick'
    `);
    await queryRunner.query(`
      DELETE FROM "smart_pick_product_suggestions"
    `);
    await queryRunner.query(`
      DELETE FROM "smart_pick_snapshots"
    `);

    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        ADD COLUMN IF NOT EXISTS "seller_names_json" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        DROP COLUMN IF EXISTS "price_cents",
        DROP COLUMN IF EXISTS "currency",
        DROP COLUMN IF EXISTS "retailers_json",
        DROP COLUMN IF EXISTS "verification_status",
        DROP COLUMN IF EXISTS "availability_status",
        DROP COLUMN IF EXISTS "local_alternative_reason",
        DROP COLUMN IF EXISTS "retailer_data_checked_at",
        DROP COLUMN IF EXISTS "retailer_data_expires_at"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "suggestion_gap_actions"
      WHERE "source_type" = 'smart_pick'
    `);
    await queryRunner.query(`
      DELETE FROM "smart_pick_product_suggestions"
    `);
    await queryRunner.query(`
      DELETE FROM "smart_pick_snapshots"
    `);

    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        ADD COLUMN IF NOT EXISTS "retailers_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "price_cents" integer,
        ADD COLUMN IF NOT EXISTS "currency" varchar(3),
        ADD COLUMN IF NOT EXISTS "verification_status" varchar(24) NOT NULL DEFAULT 'ai_named',
        ADD COLUMN IF NOT EXISTS "availability_status" varchar(24) NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS "local_alternative_reason" text,
        ADD COLUMN IF NOT EXISTS "retailer_data_checked_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "retailer_data_expires_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        DROP COLUMN IF EXISTS "seller_names_json"
    `);
  }
}
