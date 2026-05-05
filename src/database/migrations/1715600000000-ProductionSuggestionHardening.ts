import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the production guardrail tables/indexes for suggestion generation:
 * observability events and stale-job recovery support.
 */
export class ProductionSuggestionHardening1715600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "suggestion_observability_events" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26),
        "suggestion_instance_id" varchar(26),
        "job_id" varchar(26),
        "kind" varchar(40) NOT NULL,
        "severity" varchar(20) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suggestion_observability_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suggestion_observability_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_observability_kind_created"
        ON "suggestion_observability_events" ("kind", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_observability_user_created"
        ON "suggestion_observability_events" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_observability_severity_created"
        ON "suggestion_observability_events" ("severity", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_jobs_status_locked_at"
        ON "suggestion_generation_jobs" ("status", "locked_at")
        WHERE "status" = 'running'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_suggestion_jobs_status_locked_at"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "suggestion_observability_events"
    `);
  }
}
