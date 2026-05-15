import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountDeletionGracePeriod1717900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "account_deletion_requested_at" timestamptz,
        ADD COLUMN "account_deletion_scheduled_for" timestamptz,
        ADD COLUMN "account_deletion_cancel_token_hash" varchar(255),
        ADD COLUMN "account_deletion_confirm_token_hash" varchar(255),
        ADD COLUMN "account_deletion_confirm_expires" timestamptz
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_users_account_deletion_scheduled_for"
      ON "users" ("account_deletion_scheduled_for")
      WHERE "account_deletion_scheduled_for" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_users_account_deletion_cancel_token_hash"
      ON "users" ("account_deletion_cancel_token_hash")
      WHERE "account_deletion_cancel_token_hash" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_users_account_deletion_confirm_token_hash"
      ON "users" ("account_deletion_confirm_token_hash")
      WHERE "account_deletion_confirm_token_hash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_users_account_deletion_confirm_token_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_users_account_deletion_cancel_token_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_users_account_deletion_scheduled_for"`,
    );

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "account_deletion_confirm_expires",
        DROP COLUMN "account_deletion_confirm_token_hash",
        DROP COLUMN "account_deletion_cancel_token_hash",
        DROP COLUMN "account_deletion_scheduled_for",
        DROP COLUMN "account_deletion_requested_at"
    `);
  }
}
