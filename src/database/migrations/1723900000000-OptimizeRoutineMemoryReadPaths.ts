import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeRoutineMemoryReadPaths1723900000000 implements MigrationInterface {
  name = 'OptimizeRoutineMemoryReadPaths1723900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_simplification_user_started"
      ON "routine_simplification_events" ("user_id", "started_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_simplification_user_started"
    `);
  }
}
