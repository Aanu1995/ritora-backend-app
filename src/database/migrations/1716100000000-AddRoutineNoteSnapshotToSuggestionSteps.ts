import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoutineNoteSnapshotToSuggestionSteps1716100000000 implements MigrationInterface {
  name = 'AddRoutineNoteSnapshotToSuggestionSteps1716100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "suggestion_steps"
        ADD COLUMN IF NOT EXISTS "routine_note_snapshot" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "suggestion_steps"
        DROP COLUMN IF EXISTS "routine_note_snapshot"
    `);
  }
}
