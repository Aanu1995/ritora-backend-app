import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scopes suggestion context cache rows to the schedule slot time. Morning,
 * afternoon, and evening suggestions often share a date but have different
 * context windows and routine steps, so a date-only cache causes churn and
 * can reuse stale context after routine edits.
 */
export class ScopeSuggestionContextCacheByTargetTime1715500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "suggestion_context_cache"
        ADD COLUMN "target_time" time NOT NULL DEFAULT '00:00'
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_context_cache_user_date"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_context_cache_user_date_time"
        ON "suggestion_context_cache" ("user_id", "context_date", "target_time")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_context_cache_user_date_time"
    `);
    await queryRunner.query(`
      DELETE FROM "suggestion_context_cache"
      WHERE "id" NOT IN (
        SELECT DISTINCT ON ("user_id", "context_date") "id"
        FROM "suggestion_context_cache"
        ORDER BY "user_id", "context_date", "updated_at" DESC, "id" DESC
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_suggestion_context_cache_user_date"
        ON "suggestion_context_cache" ("user_id", "context_date")
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_context_cache"
        DROP COLUMN IF EXISTS "target_time"
    `);
  }
}
