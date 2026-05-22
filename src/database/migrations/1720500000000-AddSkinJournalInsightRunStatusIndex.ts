import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkinJournalInsightRunStatusIndex1720500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_insight_runs_status"
      ON "skin_journal_insight_generation_runs" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_insight_runs_status"`,
    );
  }
}
