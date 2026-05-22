import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSkinJournalInsightInteractions1718500000000 implements MigrationInterface {
  name = 'AddSkinJournalInsightInteractions1718500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "skin_journal_insight_interactions" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "insight_id" varchar(26) NOT NULL,
        "interaction_type" varchar(32) NOT NULL,
        "action_kind" varchar(40),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skin_journal_insight_interactions" PRIMARY KEY ("id"),
        CONSTRAINT "CK_skin_journal_insight_interactions_type"
          CHECK ("interaction_type" IN ('seen', 'dismissed', 'action_clicked')),
        CONSTRAINT "FK_skin_journal_insight_interactions_insight"
          FOREIGN KEY ("insight_id")
          REFERENCES "skin_journal_insights"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_insight_interactions_user_created"
      ON "skin_journal_insight_interactions" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_insight_interactions_insight_type"
      ON "skin_journal_insight_interactions" ("insight_id", "interaction_type")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "IDX_skin_journal_insight_interactions_insight_type"',
    );
    await queryRunner.query(
      'DROP INDEX "IDX_skin_journal_insight_interactions_user_created"',
    );
    await queryRunner.query('DROP TABLE "skin_journal_insight_interactions"');
  }
}
