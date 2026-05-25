import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityContentWithdrawal1723000000000 implements MigrationInterface {
  name = 'AddCommunityContentWithdrawal1723000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_routines"
        ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "withdrawn_by_user_id" varchar(26)
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "withdrawn_by_user_id" varchar(26)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_community_routines_withdrawn"
      ON "community_routines" ("withdrawn_at", "author_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_community_reviews_withdrawn"
      ON "community_reviews" ("withdrawn_at", "author_user_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routines"
      ADD CONSTRAINT "FK_community_routines_withdrawn_by_user"
      FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
      ADD CONSTRAINT "FK_community_reviews_withdrawn_by_user"
      FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
      DROP CONSTRAINT IF EXISTS "FK_community_reviews_withdrawn_by_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routines"
      DROP CONSTRAINT IF EXISTS "FK_community_routines_withdrawn_by_user"
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_reviews_withdrawn"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_routines_withdrawn"',
    );
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        DROP COLUMN IF EXISTS "withdrawn_by_user_id",
        DROP COLUMN IF EXISTS "withdrawn_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routines"
        DROP COLUMN IF EXISTS "withdrawn_by_user_id",
        DROP COLUMN IF EXISTS "withdrawn_at"
    `);
  }
}
