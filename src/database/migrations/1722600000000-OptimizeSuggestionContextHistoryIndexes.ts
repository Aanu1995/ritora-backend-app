import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeSuggestionContextHistoryIndexes1722600000000 implements MigrationInterface {
  name = 'OptimizeSuggestionContextHistoryIndexes1722600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_suggestion_instances_context_history_ready"
      ON "suggestion_instances" ("user_id", "generation_status", "target_date" DESC, "target_time" DESC, "created_at" DESC)
      WHERE "generation_status" = 'ready'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_routine_breaks_context_history"
      ON "routine_breaks" ("user_id", "starts_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_routine_breaks_context_history"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_suggestion_instances_context_history_ready"
    `);
  }
}
