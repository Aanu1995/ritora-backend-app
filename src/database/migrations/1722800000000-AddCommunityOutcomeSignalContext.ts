import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityOutcomeSignalContext1722800000000 implements MigrationInterface {
  name = 'AddCommunityOutcomeSignalContext1722800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_outcome_signal_votes"
        ADD COLUMN IF NOT EXISTS "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "safe_facets" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_community_outcome_signal_safe_facets"
      ON "community_outcome_signal_votes" USING gin ("safe_facets")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_outcome_signal_safe_facets"',
    );
    await queryRunner.query(`
      ALTER TABLE "community_outcome_signal_votes"
        DROP COLUMN IF EXISTS "safe_facets",
        DROP COLUMN IF EXISTS "context"
    `);
  }
}
