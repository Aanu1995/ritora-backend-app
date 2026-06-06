import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityOutcomeSignalWithdrawal1723400000000 implements MigrationInterface {
  name = 'AddCommunityOutcomeSignalWithdrawal1723400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_outcome_signal_votes"
        ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "withdrawn_by_user_id" varchar(26)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_community_outcome_signal_withdrawn"
      ON "community_outcome_signal_votes" ("user_id", "withdrawn_at")
    `);
    await queryRunner.query(`
      ALTER TABLE "community_outcome_signal_votes"
      ADD CONSTRAINT "FK_community_outcome_signal_withdrawn_by_user"
      FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_outcome_signal_votes"
      DROP CONSTRAINT IF EXISTS "FK_community_outcome_signal_withdrawn_by_user"
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_outcome_signal_withdrawn"',
    );
    await queryRunner.query(`
      ALTER TABLE "community_outcome_signal_votes"
        DROP COLUMN IF EXISTS "withdrawn_by_user_id",
        DROP COLUMN IF EXISTS "withdrawn_at"
    `);
  }
}
