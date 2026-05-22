import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnDemandSuggestions1716000000000 implements MigrationInterface {
  name = 'AddOnDemandSuggestions1716000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        ADD "request_source" varchar(20) NOT NULL DEFAULT 'scheduled',
        ADD "request_id" varchar(80),
        ADD "request_context" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        ALTER COLUMN "slot_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        ADD CONSTRAINT "CK_suggestion_instances_request_source"
        CHECK ("request_source" IN ('scheduled','on_demand'))
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        ADD CONSTRAINT "CK_suggestion_instances_source_slot"
        CHECK (
          ("request_source" = 'scheduled' AND "slot_id" IS NOT NULL)
          OR ("request_source" = 'on_demand' AND "slot_id" IS NULL)
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "suggestion_generation_jobs"
        ADD "suggestion_instance_id" varchar(26),
        ADD "request_source" varchar(20) NOT NULL DEFAULT 'scheduled'
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_generation_jobs"
        ALTER COLUMN "slot_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_generation_jobs"
        ADD CONSTRAINT "CK_suggestion_jobs_request_source"
        CHECK ("request_source" IN ('scheduled','on_demand'))
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_generation_jobs"
        ADD CONSTRAINT "CK_suggestion_jobs_source_links"
        CHECK (
          (
            "request_source" = 'scheduled'
            AND "slot_id" IS NOT NULL
            AND "suggestion_instance_id" IS NULL
          )
          OR (
            "request_source" = 'on_demand'
            AND "slot_id" IS NULL
            AND "suggestion_instance_id" IS NOT NULL
          )
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_generation_jobs"
        ADD CONSTRAINT "FK_suggestion_jobs_instance"
        FOREIGN KEY ("suggestion_instance_id")
        REFERENCES "suggestion_instances" ("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_jobs_user_slot_date"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_jobs_scheduled_user_slot_date"
        ON "suggestion_generation_jobs" ("user_id", "slot_id", "target_date")
        WHERE "request_source" = 'scheduled' AND "slot_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_jobs_on_demand_instance"
        ON "suggestion_generation_jobs" ("suggestion_instance_id")
        WHERE "request_source" = 'on_demand'
          AND "suggestion_instance_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_jobs_source_status_run_after"
        ON "suggestion_generation_jobs" (
          "request_source",
          "status",
          "run_after"
        )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_instances_user_source_date"
        ON "suggestion_instances" ("user_id", "request_source", "target_date")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_instances_on_demand_request_id"
        ON "suggestion_instances" ("user_id", "request_id")
        WHERE "request_source" = 'on_demand'
          AND "request_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_instances_on_demand_request_id"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_suggestion_instances_user_source_date"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_suggestion_jobs_source_status_run_after"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_jobs_on_demand_instance"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_jobs_scheduled_user_slot_date"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_jobs_user_slot_date"
        ON "suggestion_generation_jobs" ("user_id", "slot_id", "target_date")
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_generation_jobs"
        DROP CONSTRAINT IF EXISTS "FK_suggestion_jobs_instance",
        DROP CONSTRAINT IF EXISTS "CK_suggestion_jobs_source_links",
        DROP CONSTRAINT IF EXISTS "CK_suggestion_jobs_request_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_generation_jobs"
        ALTER COLUMN "slot_id" SET NOT NULL,
        DROP COLUMN "request_source",
        DROP COLUMN "suggestion_instance_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        DROP CONSTRAINT IF EXISTS "CK_suggestion_instances_source_slot",
        DROP CONSTRAINT IF EXISTS "CK_suggestion_instances_request_source",
        ALTER COLUMN "slot_id" SET NOT NULL,
        DROP COLUMN "request_context",
        DROP COLUMN "request_id",
        DROP COLUMN "request_source"
    `);
  }
}
