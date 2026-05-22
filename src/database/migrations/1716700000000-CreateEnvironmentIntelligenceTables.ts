import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEnvironmentIntelligenceTables1716700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "environment_location_cache" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "provider" varchar(30) NOT NULL,
        "location_key" varchar(64) NOT NULL,
        "location_snapshot" jsonb,
        "coordinates" jsonb,
        "provider_metadata" jsonb,
        "time_zone" varchar(80),
        "refreshed_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_environment_location_cache" PRIMARY KEY ("id"),
        CONSTRAINT "FK_environment_location_cache_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_environment_location_cache_user_provider_key"
        ON "environment_location_cache" ("user_id", "provider", "location_key")
    `);

    await queryRunner.query(`
      CREATE TABLE "environment_snapshots" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "location_cache_id" varchar(26),
        "target_date" date NOT NULL,
        "target_time_bucket" varchar(5) NOT NULL,
        "summary" jsonb,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_environment_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_environment_snapshots_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_environment_snapshots_location" FOREIGN KEY ("location_cache_id")
          REFERENCES "environment_location_cache" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_environment_snapshots_user_target"
        ON "environment_snapshots" ("user_id", "target_date", "target_time_bucket")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_environment_snapshots_expires_at"
        ON "environment_snapshots" ("expires_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        ADD COLUMN "environment_snapshot_id" varchar(26)
    `);

    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        ADD CONSTRAINT "FK_suggestion_instances_environment_snapshot"
        FOREIGN KEY ("environment_snapshot_id")
        REFERENCES "environment_snapshots" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_suggestion_instances_environment_snapshot"
        ON "suggestion_instances" ("environment_snapshot_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_suggestion_instances_environment_snapshot"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        DROP CONSTRAINT IF EXISTS "FK_suggestion_instances_environment_snapshot"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        DROP COLUMN IF EXISTS "environment_snapshot_id"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "environment_snapshots"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "environment_location_cache"
    `);
  }
}
