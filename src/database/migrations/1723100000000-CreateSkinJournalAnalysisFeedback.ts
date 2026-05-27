import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSkinJournalAnalysisFeedback1723100000000 implements MigrationInterface {
  name = 'CreateSkinJournalAnalysisFeedback1723100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "skin_journal_analysis_feedback" (
        "id" varchar(26) NOT NULL,
        "vote" varchar(20) NOT NULL,
        "reason" varchar(40),
        "note" text,
        "interpretation_version" varchar(20),
        "reading_label" varchar(20),
        "concern_keys" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skin_journal_analysis_feedback" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_skin_journal_analysis_feedback_vote_created"
      ON "skin_journal_analysis_feedback" ("vote", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_skin_journal_analysis_feedback_reason_created"
      ON "skin_journal_analysis_feedback" ("reason", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_skin_journal_analysis_feedback_reason_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_skin_journal_analysis_feedback_vote_created"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "skin_journal_analysis_feedback"`,
    );
  }
}
