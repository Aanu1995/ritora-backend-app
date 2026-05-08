import { MigrationInterface, QueryRunner } from 'typeorm';

const NOTIFICATION_KINDS_WITH_PRODUCT_EXPIRY = `
  'photo_reminder','reaction_detected','simplification_started',
  'doctor_referral','insight_ready','wrapped_ready','analysis_failed',
  'export_ready','suggestion_ready','slot_start','recording_reminder',
  'product_nearing_expiry','product_expired'
`;

const NOTIFICATION_KINDS_WITHOUT_PRODUCT_EXPIRY = `
  'photo_reminder','reaction_detected','simplification_started',
  'doctor_referral','insight_ready','wrapped_ready','analysis_failed',
  'export_ready','suggestion_ready','slot_start','recording_reminder'
`;

export class AddProductExpiryNotifications1716400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        ADD COLUMN "product_expiry_alerts_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN "product_expiry_notice_days" integer NOT NULL DEFAULT 14
    `);

    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        ADD CONSTRAINT "CK_user_notif_product_expiry_notice_days"
        CHECK ("product_expiry_notice_days" BETWEEN 1 AND 90)
    `);

    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP CONSTRAINT IF EXISTS "CK_in_app_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITH_PRODUCT_EXPIRY})
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "scheduled_notifications"
        DROP CONSTRAINT IF EXISTS "CK_scheduled_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "scheduled_notifications"
        ADD CONSTRAINT "CK_scheduled_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITH_PRODUCT_EXPIRY})
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "scheduled_notifications"
        DROP CONSTRAINT IF EXISTS "CK_scheduled_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "scheduled_notifications"
        ADD CONSTRAINT "CK_scheduled_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITHOUT_PRODUCT_EXPIRY})
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP CONSTRAINT IF EXISTS "CK_in_app_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITHOUT_PRODUCT_EXPIRY})
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        DROP CONSTRAINT IF EXISTS "CK_user_notif_product_expiry_notice_days"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_notification_preferences"
        DROP COLUMN IF EXISTS "product_expiry_notice_days",
        DROP COLUMN IF EXISTS "product_expiry_alerts_enabled"
    `);
  }
}
