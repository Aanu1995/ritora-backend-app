import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the user-wide suggestion preferences:
 *  - Three new notification-kind toggles (suggestion_ready, slot_start,
 *    recording_reminder) so users can mute any kind without losing
 *    reaction alerts.
 *  - `suggestion_lead_time_minutes` (default 120, range 30 to 720) which
 *    drives when each slot's suggestion becomes visible on Today's
 *    Suggestion and when the corresponding push goes out.
 *  - Quiet hours (start, end, enabled) honoured by slot_start and
 *    recording_reminder. Reaction alerts always come through.
 */
export class AddSuggestionAndQuietHoursPreferences1714800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        ADD COLUMN "suggestion_ready_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN "slot_start_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN "recording_reminder_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN "suggestion_lead_time_minutes" integer NOT NULL DEFAULT 120,
        ADD COLUMN "quiet_hours_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN "quiet_hours_start" time NOT NULL DEFAULT '22:30',
        ADD COLUMN "quiet_hours_end" time NOT NULL DEFAULT '06:30'
    `);

    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        ADD CONSTRAINT "CK_user_notif_lead_time_range"
        CHECK ("suggestion_lead_time_minutes" BETWEEN 30 AND 720)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        DROP CONSTRAINT IF EXISTS "CK_user_notif_lead_time_range"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        DROP COLUMN IF EXISTS "quiet_hours_end",
        DROP COLUMN IF EXISTS "quiet_hours_start",
        DROP COLUMN IF EXISTS "quiet_hours_enabled",
        DROP COLUMN IF EXISTS "suggestion_lead_time_minutes",
        DROP COLUMN IF EXISTS "recording_reminder_enabled",
        DROP COLUMN IF EXISTS "slot_start_enabled",
        DROP COLUMN IF EXISTS "suggestion_ready_enabled"
    `);
  }
}
