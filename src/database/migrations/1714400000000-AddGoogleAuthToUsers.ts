import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleAuthToUsers1714400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "password_hash" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD "google_subject" varchar(255)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_users_google_subject"
      ON "users" ("google_subject")
      WHERE "google_subject" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_users_google_subject"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "google_subject"`);
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "password_hash" SET NOT NULL
    `);
  }
}
