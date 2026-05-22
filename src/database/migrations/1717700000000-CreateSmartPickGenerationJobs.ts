import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSmartPickGenerationJobs1717700000000 implements MigrationInterface {
  name = 'CreateSmartPickGenerationJobs1717700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "smart_pick_generation_jobs" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "mode" varchar(16) NOT NULL,
        "inputs_hash" varchar(64) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'queued',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 3,
        "run_after" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" varchar(64),
        "last_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_pick_generation_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_smart_pick_generation_jobs_mode"
          CHECK ("mode" IN ('refine', 'starter')),
        CONSTRAINT "CHK_smart_pick_generation_jobs_status"
          CHECK ("status" IN ('queued', 'sent', 'running', 'completed', 'failed')),
        CONSTRAINT "FK_smart_pick_generation_jobs_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_smart_pick_generation_jobs_status_run_after"
        ON "smart_pick_generation_jobs" ("status", "run_after")
        WHERE "status" IN ('queued', 'sent', 'running')
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_smart_pick_generation_jobs_active_hash"
        ON "smart_pick_generation_jobs" ("user_id", "mode", "inputs_hash")
        WHERE "status" IN ('queued', 'sent', 'running')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_smart_pick_generation_jobs_user_mode_hash"
        ON "smart_pick_generation_jobs" (
          "user_id", "mode", "inputs_hash", "updated_at"
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_smart_pick_generation_jobs_user_mode_hash"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_smart_pick_generation_jobs_active_hash"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_smart_pick_generation_jobs_status_run_after"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "smart_pick_generation_jobs"
    `);
  }
}
