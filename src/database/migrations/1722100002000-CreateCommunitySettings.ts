import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommunitySettings1722100002000 implements MigrationInterface {
  name = 'CreateCommunitySettings1722100002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'community_settings_updated'
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_settings" (
        "id" varchar(32) PRIMARY KEY,
        "minimum_account_age_days" integer NOT NULL DEFAULT 3,
        "updated_by_admin_id" varchar(26),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_community_settings_minimum_account_age_days"
          CHECK ("minimum_account_age_days" >= 0 AND "minimum_account_age_days" <= 30),
        CONSTRAINT "FK_community_settings_updated_by_admin"
          FOREIGN KEY ("updated_by_admin_id") REFERENCES "admin_accounts" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO "community_settings" ("id", "minimum_account_age_days")
      VALUES ('default', 3)
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "community_settings"');
  }
}
