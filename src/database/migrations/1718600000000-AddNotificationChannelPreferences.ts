import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationChannelPreferences1718600000000 implements MigrationInterface {
  name = 'AddNotificationChannelPreferences1718600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        ALTER COLUMN "channels" SET DEFAULT '["in_app"]'::jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        ADD COLUMN "reaction_alert_channels" jsonb,
        ADD COLUMN "simplification_alert_channels" jsonb,
        ADD COLUMN "insight_alert_channels" jsonb,
        ADD COLUMN "wrapped_alert_channels" jsonb,
        ADD COLUMN "suggestion_ready_channels" jsonb,
        ADD COLUMN "smart_pick_ready_channels" jsonb,
        ADD COLUMN "slot_start_channels" jsonb,
        ADD COLUMN "recording_reminder_channels" jsonb,
        ADD COLUMN "product_expiry_alert_channels" jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        ALTER COLUMN "channels" SET DEFAULT '["in_app","email"]'::jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        DROP COLUMN IF EXISTS "product_expiry_alert_channels",
        DROP COLUMN IF EXISTS "recording_reminder_channels",
        DROP COLUMN IF EXISTS "slot_start_channels",
        DROP COLUMN IF EXISTS "smart_pick_ready_channels",
        DROP COLUMN IF EXISTS "suggestion_ready_channels",
        DROP COLUMN IF EXISTS "wrapped_alert_channels",
        DROP COLUMN IF EXISTS "insight_alert_channels",
        DROP COLUMN IF EXISTS "simplification_alert_channels",
        DROP COLUMN IF EXISTS "reaction_alert_channels"
    `);
  }
}
