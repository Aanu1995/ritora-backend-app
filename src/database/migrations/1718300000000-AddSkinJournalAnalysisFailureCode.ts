import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkinJournalAnalysisFailureCode1718300000000 implements MigrationInterface {
  name = 'AddSkinJournalAnalysisFailureCode1718300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      ADD COLUMN IF NOT EXISTS "analysis_error_code" varchar(40)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_skin_journal_entries_analysis_error_code"
      ON "skin_journal_entries" ("analysis_error_code")
      WHERE "analysis_error_code" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_skin_journal_entries_analysis_error_code"`,
    );
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      DROP COLUMN IF EXISTS "analysis_error_code"
    `);
  }
}
