import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkinJournalAnalysisFeedbackMarker1723100002000 implements MigrationInterface {
  name = 'AddSkinJournalAnalysisFeedbackMarker1723100002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      ADD COLUMN IF NOT EXISTS "analysis_feedback_submitted" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      ADD COLUMN IF NOT EXISTS "analysis_feedback_submitted_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      ADD COLUMN IF NOT EXISTS "analysis_feedback_interpretation_version" varchar(20)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_skin_journal_entries_feedback_submitted"
      ON "skin_journal_entries" ("analysis_feedback_submitted", "analysis_feedback_submitted_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_skin_journal_entries_feedback_submitted"`,
    );
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      DROP COLUMN IF EXISTS "analysis_feedback_interpretation_version"
    `);
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      DROP COLUMN IF EXISTS "analysis_feedback_submitted_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      DROP COLUMN IF EXISTS "analysis_feedback_submitted"
    `);
  }
}
