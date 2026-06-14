import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommunityBookmarks1723600000000 implements MigrationInterface {
  name = 'CreateCommunityBookmarks1723600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_bookmarks" (
        "id" varchar(26) PRIMARY KEY,
        "user_id" varchar(26) NOT NULL,
        "content_type" varchar(20) NOT NULL,
        "content_id" varchar(26) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_community_bookmarks_unique"
      ON "community_bookmarks" ("user_id", "content_type", "content_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_community_bookmarks_user_created"
      ON "community_bookmarks" ("user_id", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        ALTER TABLE "community_bookmarks"
        ADD CONSTRAINT "FK_community_bookmarks_user"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_bookmarks"
      DROP CONSTRAINT IF EXISTS "FK_community_bookmarks_user"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_community_bookmarks_user_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_community_bookmarks_unique"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "community_bookmarks"`);
  }
}
