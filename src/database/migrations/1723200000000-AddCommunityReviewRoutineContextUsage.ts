import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityReviewRoutineContextUsage1723200000000 implements MigrationInterface {
  name = 'AddCommunityReviewRoutineContextUsage1723200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        ADD COLUMN IF NOT EXISTS "routine_context_usage" varchar(30) NOT NULL DEFAULT 'with_products'
    `);
    await queryRunner.query(`
      UPDATE "community_reviews" review
      SET "routine_context_usage" = 'used_alone'
      WHERE NOT EXISTS (
        SELECT 1
        FROM "community_review_context_products" context
        WHERE context."review_id" = review."id"
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        ADD CONSTRAINT "CK_community_reviews_routine_context_usage"
        CHECK ("routine_context_usage" IN ('used_alone', 'with_products', 'not_sure'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        DROP CONSTRAINT IF EXISTS "CK_community_reviews_routine_context_usage"
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        DROP COLUMN IF EXISTS "routine_context_usage"
    `);
  }
}
