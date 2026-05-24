import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityReviewEvidenceFields1722600000000
  implements MigrationInterface
{
  name = 'AddCommunityReviewEvidenceFields1722600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        ADD COLUMN IF NOT EXISTS "routine_slot" varchar(20),
        ADD COLUMN IF NOT EXISTS "skin_response" varchar(30),
        ADD COLUMN IF NOT EXISTS "overall_rating" integer,
        ADD COLUMN IF NOT EXISTS "effectiveness_rating" integer,
        ADD COLUMN IF NOT EXISTS "irritation_rating" integer,
        ADD COLUMN IF NOT EXISTS "texture_rating" integer,
        ADD COLUMN IF NOT EXISTS "value_rating" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        ADD CONSTRAINT "CK_community_reviews_routine_slot"
        CHECK (
          "routine_slot" IS NULL
          OR "routine_slot" IN ('am', 'pm', 'am-pm', 'either')
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        ADD CONSTRAINT "CK_community_reviews_skin_response"
        CHECK (
          "skin_response" IS NULL
          OR "skin_response" IN ('improved', 'no_change', 'mixed', 'worsened')
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        ADD CONSTRAINT "CK_community_reviews_ratings_1_to_5"
        CHECK (
          ("overall_rating" IS NULL OR "overall_rating" BETWEEN 1 AND 5)
          AND ("effectiveness_rating" IS NULL OR "effectiveness_rating" BETWEEN 1 AND 5)
          AND ("irritation_rating" IS NULL OR "irritation_rating" BETWEEN 1 AND 5)
          AND ("texture_rating" IS NULL OR "texture_rating" BETWEEN 1 AND 5)
          AND ("value_rating" IS NULL OR "value_rating" BETWEEN 1 AND 5)
        )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_community_reviews_product_evidence"
      ON "community_reviews" (
        "product_id",
        "moderation_status",
        "overall_rating",
        "skin_response"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_reviews_product_evidence"',
    );
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        DROP CONSTRAINT IF EXISTS "CK_community_reviews_ratings_1_to_5",
        DROP CONSTRAINT IF EXISTS "CK_community_reviews_skin_response",
        DROP CONSTRAINT IF EXISTS "CK_community_reviews_routine_slot"
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        DROP COLUMN IF EXISTS "value_rating",
        DROP COLUMN IF EXISTS "texture_rating",
        DROP COLUMN IF EXISTS "irritation_rating",
        DROP COLUMN IF EXISTS "effectiveness_rating",
        DROP COLUMN IF EXISTS "overall_rating",
        DROP COLUMN IF EXISTS "skin_response",
        DROP COLUMN IF EXISTS "routine_slot"
    `);
  }
}
