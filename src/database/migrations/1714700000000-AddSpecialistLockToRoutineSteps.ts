import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-step specialist lock for the AI suggestion engine. When set, the
 * suggestion generator must respect the step exactly as authored: never
 * remove, reorder, or replace it.
 */
export class AddSpecialistLockToRoutineSteps1714700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "routine_steps"
      ADD COLUMN "is_specialist_locked" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_routine_steps_specialist_locked"
        ON "routine_steps" ("slot_id", "is_specialist_locked")
        WHERE "is_specialist_locked" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_routine_steps_specialist_locked"`,
    );
    await queryRunner.query(
      `ALTER TABLE "routine_steps" DROP COLUMN "is_specialist_locked"`,
    );
  }
}
