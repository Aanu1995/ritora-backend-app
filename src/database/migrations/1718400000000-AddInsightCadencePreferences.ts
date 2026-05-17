import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInsightCadencePreferences1718400000000 implements MigrationInterface {
  name = 'AddInsightCadencePreferences1718400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        ADD COLUMN "insight_cadence" varchar(16) NOT NULL DEFAULT 'weekly',
        ADD COLUMN "insight_digest_day" integer NOT NULL DEFAULT 1,
        ADD COLUMN "insight_digest_local_time" time NOT NULL DEFAULT '09:00',
        ADD CONSTRAINT "CK_user_notification_preferences_insight_cadence"
          CHECK ("insight_cadence" IN ('weekly', 'fewer')),
        ADD CONSTRAINT "CK_user_notification_preferences_insight_digest_day"
          CHECK ("insight_digest_day" BETWEEN 1 AND 7)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        DROP CONSTRAINT "CK_user_notification_preferences_insight_digest_day",
        DROP CONSTRAINT "CK_user_notification_preferences_insight_cadence",
        DROP COLUMN "insight_digest_local_time",
        DROP COLUMN "insight_digest_day",
        DROP COLUMN "insight_cadence"
    `);
  }
}
