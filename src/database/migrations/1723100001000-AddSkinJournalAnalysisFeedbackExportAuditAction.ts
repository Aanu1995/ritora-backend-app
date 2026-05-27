import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkinJournalAnalysisFeedbackExportAuditAction1723100001000 implements MigrationInterface {
  name = 'AddSkinJournalAnalysisFeedbackExportAuditAction1723100001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'skin_journal_analysis_feedback_exported'
    `);
  }

  async down(): Promise<void> {
    // PostgreSQL enum values are intentionally not removed.
  }
}
