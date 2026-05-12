import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandSmartPickVerificationStatus1717300000000 implements MigrationInterface {
  name = 'ExpandSmartPickVerificationStatus1717300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        DROP CONSTRAINT IF EXISTS "CK_smart_pick_product_suggestions_verification"
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        ADD CONSTRAINT "CK_smart_pick_product_suggestions_verification" CHECK (
          "verification_status" IN (
            'ai_named',
            'retailer_verified',
            'retailer_unverified',
            'unavailable'
          )
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "smart_pick_product_suggestions"
      SET "verification_status" = 'ai_named'
      WHERE "verification_status" IN ('retailer_verified','retailer_unverified')
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        DROP CONSTRAINT IF EXISTS "CK_smart_pick_product_suggestions_verification"
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_product_suggestions"
        ADD CONSTRAINT "CK_smart_pick_product_suggestions_verification" CHECK (
          "verification_status" IN ('ai_named','unavailable')
        )
    `);
  }
}
