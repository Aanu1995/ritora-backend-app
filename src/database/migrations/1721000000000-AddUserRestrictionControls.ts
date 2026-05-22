import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRestrictionControls1721000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "account_restriction_capabilities" varchar(80)[],
        ADD COLUMN IF NOT EXISTS "account_restriction_expires_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "account_restriction_internal_note" text,
        ADD COLUMN IF NOT EXISTS "account_restriction_user_message" text
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_account_restriction_expires_at"
      ON "users" ("account_restriction_expires_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_active_restriction_lookup"
      ON "users" ("account_restricted_at", "account_restriction_expires_at")
      WHERE "account_restricted_at" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_account_restriction_capabilities_gin"
      ON "users" USING GIN ("account_restriction_capabilities")
      WHERE "account_restricted_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_users_account_restriction_capabilities_gin"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_users_active_restriction_lookup"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_users_account_restriction_expires_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "account_restriction_user_message",
        DROP COLUMN IF EXISTS "account_restriction_internal_note",
        DROP COLUMN IF EXISTS "account_restriction_expires_at",
        DROP COLUMN IF EXISTS "account_restriction_capabilities"
    `);
  }
}
