import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRoutineBreaks1715900000000 implements MigrationInterface {
  name = 'CreateRoutineBreaks1715900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "routine_breaks" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "starts_at" timestamptz NOT NULL,
        "ends_at" timestamptz,
        "reason" text,
        "status" varchar(20) NOT NULL DEFAULT 'active',
        "resumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_routine_breaks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_routine_breaks_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_routine_breaks_status" CHECK (
          "status" IN ('active','resumed')
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_routine_breaks_user_status_starts"
        ON "routine_breaks" ("user_id", "status", "starts_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_routine_breaks_user_ends"
        ON "routine_breaks" ("user_id", "ends_at")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_routine_breaks_user_open_active"
        ON "routine_breaks" ("user_id")
        WHERE "status" = 'active' AND "ends_at" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_routine_breaks_user_open_active"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "routine_breaks"`);
  }
}
