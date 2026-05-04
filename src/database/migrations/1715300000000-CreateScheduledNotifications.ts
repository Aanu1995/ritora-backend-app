import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists delayed notifications when quiet hours suppress a non-urgent
 * dispatch. This keeps one-shot events such as suggestion_ready from
 * disappearing when the user's quiet-hours window is active.
 */
export class CreateScheduledNotifications1715300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scheduled_notifications" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "kind" varchar(40) NOT NULL,
        "title_key" text NOT NULL,
        "body_key" text NOT NULL,
        "severity" varchar(20) NOT NULL DEFAULT 'info',
        "dedupe_key" varchar(160),
        "payload" jsonb,
        "deep_link" text,
        "deliver_at" timestamptz NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "locked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scheduled_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_scheduled_notifications_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_scheduled_notifications_status" CHECK (
          "status" IN ('pending','dispatching','sent','cancelled','failed')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_scheduled_notifications_due"
        ON "scheduled_notifications" ("status", "deliver_at")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_scheduled_notifications_user_kind_dedupe"
        ON "scheduled_notifications" ("user_id", "kind", "dedupe_key")
        WHERE "dedupe_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "scheduled_notifications"`);
  }
}
