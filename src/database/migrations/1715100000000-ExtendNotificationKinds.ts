import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extends the in_app_notifications kind enum check with the three new
 * Today's Suggestion notification kinds. The matching i18n keys live
 * under notificationsPage.kinds.{suggestion_ready, slot_start,
 * recording_reminder} on the frontend.
 */
export class ExtendNotificationKinds1715100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP CONSTRAINT IF EXISTS "CK_in_app_notifications_kind"
    `);

    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (
            'photo_reminder','reaction_detected','simplification_started',
            'doctor_referral','insight_ready','wrapped_ready','analysis_failed',
            'export_ready','suggestion_ready','slot_start','recording_reminder'
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP CONSTRAINT IF EXISTS "CK_in_app_notifications_kind"
    `);

    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (
            'photo_reminder','reaction_detected','simplification_started',
            'doctor_referral','insight_ready','wrapped_ready','analysis_failed','export_ready'
          )
        )
    `);
  }
}
