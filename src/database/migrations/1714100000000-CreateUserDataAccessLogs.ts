import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserDataAccessLogs1714100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_data_access_logs" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "consent_type" varchar(50) NOT NULL,
        "event_type" varchar(40) NOT NULL,
        "actor_type" varchar(20) NOT NULL,
        "purpose" varchar(80) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_data_access_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_data_access_logs_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_user_data_access_logs_user_created"
        ON "user_data_access_logs" ("user_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_user_data_access_logs_user_consent_created"
        ON "user_data_access_logs" ("user_id", "consent_type", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "idx_user_data_access_logs_user_consent_created"
    `);
    await queryRunner.query(`
      DROP INDEX "idx_user_data_access_logs_user_created"
    `);
    await queryRunner.query(`DROP TABLE "user_data_access_logs"`);
  }
}
