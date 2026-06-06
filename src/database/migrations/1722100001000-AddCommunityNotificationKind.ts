import { MigrationInterface, QueryRunner } from 'typeorm';

const NOTIFICATION_KINDS_WITH_COMMUNITY = `
  'photo_reminder','reaction_detected','simplification_started',
  'doctor_referral','insight_ready','wrapped_ready','analysis_failed',
  'export_ready','suggestion_ready','slot_start','recording_reminder',
  'product_nearing_expiry','product_expired','smart_pick_ready',
  'community_moderation'
`;

const NOTIFICATION_KINDS_WITHOUT_COMMUNITY = `
  'photo_reminder','reaction_detected','simplification_started',
  'doctor_referral','insight_ready','wrapped_ready','analysis_failed',
  'export_ready','suggestion_ready','slot_start','recording_reminder',
  'product_nearing_expiry','product_expired','smart_pick_ready'
`;

export class AddCommunityNotificationKind1722100001000 implements MigrationInterface {
  name = 'AddCommunityNotificationKind1722100001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        DROP CONSTRAINT IF EXISTS "CK_in_app_notifications_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "in_app_notifications"
        ADD CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (${NOTIFICATION_KINDS_WITH_COMMUNITY})
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
          "kind" IN (${NOTIFICATION_KINDS_WITHOUT_COMMUNITY})
        )
    `);
  }
}
