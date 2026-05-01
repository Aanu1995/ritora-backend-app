import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationTables1714300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_notification_preferences" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "photo_reminder_local_time" time NOT NULL DEFAULT '08:00',
        "photo_reminder_enabled" boolean NOT NULL DEFAULT true,
        "channels" jsonb NOT NULL DEFAULT '["in_app","email"]'::jsonb,
        "reaction_alerts_enabled" boolean NOT NULL DEFAULT true,
        "simplification_alerts_enabled" boolean NOT NULL DEFAULT true,
        "insight_alerts_enabled" boolean NOT NULL DEFAULT true,
        "ai_polished_insights_enabled" boolean NOT NULL DEFAULT true,
        "wrapped_alerts_enabled" boolean NOT NULL DEFAULT true,
        "photo_tutorial_completed" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_notification_preferences" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_notification_preferences_user" UNIQUE ("user_id"),
        CONSTRAINT "FK_user_notification_preferences_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "in_app_notifications" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "kind" varchar(40) NOT NULL,
        "title_key" text NOT NULL,
        "body_key" text NOT NULL,
        "payload" jsonb,
        "severity" varchar(20) NOT NULL DEFAULT 'info',
        "deep_link" text,
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_in_app_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_in_app_notifications_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_in_app_notifications_kind" CHECK (
          "kind" IN (
            'photo_reminder','reaction_detected','simplification_started',
            'doctor_referral','insight_ready','wrapped_ready','analysis_failed','export_ready'
          )
        ),
        CONSTRAINT "CK_in_app_notifications_severity" CHECK (
          "severity" IN ('info','warning','critical')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_in_app_notifications_user_read_created"
        ON "in_app_notifications" ("user_id", "read_at", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_in_app_notifications_user_unread"
        ON "in_app_notifications" ("user_id")
        WHERE "read_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "in_app_notifications"`);
    await queryRunner.query(`DROP TABLE "user_notification_preferences"`);
  }
}
