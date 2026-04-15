import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserConsentsTable1713000200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_consents" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "consent_type" varchar(50) NOT NULL,
        "consent_version" varchar(20) NOT NULL,
        "granted" boolean NOT NULL,
        "granted_at" timestamptz,
        "revoked_at" timestamptz,
        "ip_address" varchar(45),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_consents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_consents_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_user_consents_user_id" ON "user_consents" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_consents"`);
  }
}
