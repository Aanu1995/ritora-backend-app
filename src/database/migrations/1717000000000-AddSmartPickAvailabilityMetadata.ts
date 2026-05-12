import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmartPickAvailabilityMetadata1717000000000 implements MigrationInterface {
  name = 'AddSmartPickAvailabilityMetadata1717000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        ADD COLUMN IF NOT EXISTS "availability_status" varchar(24) NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS "recommendation_rank_reason" text,
        ADD COLUMN IF NOT EXISTS "local_alternative_reason" text
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        DROP CONSTRAINT IF EXISTS "CK_smart_pick_product_suggestions_availability"
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        ADD CONSTRAINT "CK_smart_pick_product_suggestions_availability" CHECK (
          "availability_status" IN ('local','import_only','unavailable','unknown')
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        DROP CONSTRAINT IF EXISTS "CK_smart_pick_product_suggestions_availability"
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        DROP COLUMN IF EXISTS "local_alternative_reason",
        DROP COLUMN IF EXISTS "recommendation_rank_reason",
        DROP COLUMN IF EXISTS "availability_status"
    `);
  }
}
