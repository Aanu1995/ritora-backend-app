import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkinJournalReactionReport1723800000000 implements MigrationInterface {
  name = 'AddSkinJournalReactionReport1723800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      ADD COLUMN IF NOT EXISTS "reaction_report" jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "skin_journal_entries"
      DROP COLUMN IF EXISTS "reaction_report"
    `);
  }
}
