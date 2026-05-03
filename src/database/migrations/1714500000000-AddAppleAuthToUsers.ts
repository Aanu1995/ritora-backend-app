import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppleAuthToUsers1714500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD "apple_subject" varchar(255)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_users_apple_subject"
      ON "users" ("apple_subject")
      WHERE "apple_subject" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_users_apple_subject"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "apple_subject"`);
  }
}
