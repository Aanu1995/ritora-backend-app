import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeScheduledSuggestionActiveIndexByTargetTime1724500000000 implements MigrationInterface {
  name = 'ScopeScheduledSuggestionActiveIndexByTargetTime1724500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_instances_user_slot_date_active"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_suggestion_instances_user_slot_date_time_active"
      ON "suggestion_instances" ("user_id", "slot_id", "target_date", "target_time")
      WHERE "generation_status" <> 'superseded' AND "slot_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_suggestion_instances_user_slot_date_time_active"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_suggestion_instances_user_slot_date_active"
      ON "suggestion_instances" ("user_id", "slot_id", "target_date")
      WHERE "generation_status" <> 'superseded' AND "slot_id" IS NOT NULL
    `);
  }
}
