import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityOutcomeResultNotes1723300000000 implements MigrationInterface {
  name = 'AddCommunityOutcomeResultNotes1723300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_outcome_signal_votes"
        ADD COLUMN IF NOT EXISTS "note" varchar(500),
        ADD COLUMN IF NOT EXISTS "note_moderation_status" varchar(30) NOT NULL DEFAULT 'published',
        ADD COLUMN IF NOT EXISTS "note_safety_flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "note_moderation_reason" varchar(500)
    `);
    await queryRunner.query(`
      UPDATE "community_outcome_signal_votes"
      SET
        "note_moderation_status" = 'pending_review',
        "note_moderation_reason" = COALESCE(
          "note_moderation_reason",
          'Existing result note or companion-product context requires moderation before public display.'
        )
      WHERE "note_moderation_status" = 'published'
        AND (
          "note" IS NOT NULL
          OR (
            jsonb_typeof("context" -> 'usedWithProducts') = 'array'
            AND jsonb_array_length("context" -> 'usedWithProducts') > 0
          )
        )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_community_outcome_signal_note_status"
      ON "community_outcome_signal_votes" ("note_moderation_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_outcome_signal_note_status"',
    );
    await queryRunner.query(`
      ALTER TABLE "community_outcome_signal_votes"
        DROP COLUMN IF EXISTS "note_moderation_reason",
        DROP COLUMN IF EXISTS "note_safety_flags",
        DROP COLUMN IF EXISTS "note_moderation_status",
        DROP COLUMN IF EXISTS "note"
    `);
  }
}
