import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1713000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" varchar(26) NOT NULL,
        "email" varchar(255) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "first_name" varchar(100) NOT NULL,
        "last_name" varchar(100) NOT NULL,
        "email_verified" boolean NOT NULL DEFAULT false,
        "email_verification_token_hash" varchar(255),
        "email_verification_expires" timestamptz,
        "password_reset_token_hash" varchar(255),
        "password_reset_expires" timestamptz,
        "preferred_language" varchar(5) NOT NULL DEFAULT 'en',
        "date_of_birth" date,
        "sex_at_birth" varchar(20),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_users_email_lower" ON "users" (LOWER("email"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_users_email_lower"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
