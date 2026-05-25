import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendCommunityGoalTimeframes1722900000000 implements MigrationInterface {
  name = 'ExtendCommunityGoalTimeframes1722900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "community_routines"
        DROP CONSTRAINT IF EXISTS "CK_community_routines_timeframe"
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
        DROP CONSTRAINT IF EXISTS "CK_community_routines_timeframe"
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
            '3-months-plus'
          )
        )
    `);
  }
}
