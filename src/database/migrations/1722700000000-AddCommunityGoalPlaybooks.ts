import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommunityGoalPlaybooks1722700000000
  implements MigrationInterface
{
  name = 'AddCommunityGoalPlaybooks1722700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_routines"
        ADD COLUMN IF NOT EXISTS "goal_result" varchar(30),
        ADD COLUMN IF NOT EXISTS "timeframe" varchar(30),
        ADD COLUMN IF NOT EXISTS "avoid_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "habit_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "did_not_work_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "warning_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "outcome_signal_counts" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        ADD COLUMN IF NOT EXISTS "outcome_signal_counts" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "community_outcome_signal_votes" (
        "id" varchar(26) PRIMARY KEY,
        "user_id" varchar(26) NOT NULL,
        "content_type" varchar(20) NOT NULL,
        "content_id" varchar(26) NOT NULL,
        "signal" varchar(30) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_community_outcome_signal_unique"
      ON "community_outcome_signal_votes" ("user_id", "content_type", "content_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_community_outcome_signal_content"
      ON "community_outcome_signal_votes" ("content_type", "content_id", "signal")
    `);
    await queryRunner.query(`
      ALTER TABLE "community_outcome_signal_votes"
      ADD CONSTRAINT "FK_community_outcome_signal_user"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routines"
        ADD CONSTRAINT "CK_community_routines_goal_result"
        CHECK (
          "goal_result" IS NULL
          OR "goal_result" IN (
            'achieved',
            'mostly_improved',
            'partially_improved',
            'maintained',
            'mixed'
          )
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routines"
        ADD CONSTRAINT "CK_community_routines_timeframe"
        CHECK (
          "timeframe" IS NULL
          OR "timeframe" IN (
            '2-weeks',
            '4-weeks',
            '8-weeks',
            '3-months',
            '3-months-plus',
            '6-months',
            '12-months-plus'
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_routines"
        DROP CONSTRAINT IF EXISTS "CK_community_routines_timeframe",
        DROP CONSTRAINT IF EXISTS "CK_community_routines_goal_result"
    `);
    await queryRunner.query(
      'ALTER TABLE "community_outcome_signal_votes" DROP CONSTRAINT IF EXISTS "FK_community_outcome_signal_user"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_outcome_signal_content"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_community_outcome_signal_unique"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "community_outcome_signal_votes"',
    );
    await queryRunner.query(`
      ALTER TABLE "community_reviews"
        DROP COLUMN IF EXISTS "outcome_signal_counts"
    `);
    await queryRunner.query(`
      ALTER TABLE "community_routines"
        DROP COLUMN IF EXISTS "outcome_signal_counts",
        DROP COLUMN IF EXISTS "warning_tags",
        DROP COLUMN IF EXISTS "did_not_work_tags",
        DROP COLUMN IF EXISTS "habit_tags",
        DROP COLUMN IF EXISTS "avoid_tags",
        DROP COLUMN IF EXISTS "timeframe",
        DROP COLUMN IF EXISTS "goal_result"
    `);
  }
}
