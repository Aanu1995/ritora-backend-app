import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountDeletionCancelIdempotency1718100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "account_deletion_cancel_token_consumed_at" timestamptz
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_users_account_deletion_cancel_token_consumed_at"
      ON "users" ("account_deletion_cancel_token_consumed_at")
      WHERE "account_deletion_cancel_token_consumed_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_users_account_deletion_cancel_token_consumed_at"`,
    );

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "account_deletion_cancel_token_consumed_at"
    `);
  }
}
