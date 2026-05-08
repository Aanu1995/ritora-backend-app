import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePushNotificationSubscriptions1716500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "push_notification_subscriptions" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "provider" varchar(20) NOT NULL,
        "platform" varchar(20) NOT NULL,
        "endpoint" text,
        "endpoint_hash" char(64),
        "web_push_keys" jsonb,
        "mobile_token" jsonb,
        "token_hash" char(64),
        "device_name" varchar(120),
        "user_agent" text,
        "last_seen_at" timestamptz,
        "revoked_at" timestamptz,
        "failure_count" integer NOT NULL DEFAULT 0,
        "last_failure_at" timestamptz,
        "last_failure_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_notification_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "CK_push_subscriptions_provider" CHECK ("provider" IN ('web_push','fcm','apns')),
        CONSTRAINT "CK_push_subscriptions_platform" CHECK ("platform" IN ('web','ios','android')),
        CONSTRAINT "FK_push_subscriptions_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_push_subscriptions_user_active"
        ON "push_notification_subscriptions" ("user_id", "revoked_at")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_push_subscriptions_provider_endpoint_hash"
        ON "push_notification_subscriptions" ("provider", "endpoint_hash")
        WHERE "endpoint_hash" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_push_subscriptions_provider_token_hash"
        ON "push_notification_subscriptions" ("provider", "token_hash")
        WHERE "token_hash" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "push_notification_deliveries" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "subscription_id" varchar(26) NOT NULL,
        "notification_id" varchar(26),
        "kind" varchar(40) NOT NULL,
        "severity" varchar(20) NOT NULL DEFAULT 'info',
        "dedupe_key" varchar(160),
        "status" varchar(20) NOT NULL,
        "provider_status_code" integer,
        "error_message" text,
        "attempted_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_notification_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "CK_push_deliveries_status" CHECK ("status" IN ('sending','sent','failed','skipped')),
        CONSTRAINT "FK_push_deliveries_subscription"
          FOREIGN KEY ("subscription_id") REFERENCES "push_notification_subscriptions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_push_deliveries_user_attempted"
        ON "push_notification_deliveries" ("user_id", "attempted_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_push_deliveries_subscription_attempted"
        ON "push_notification_deliveries" ("subscription_id", "attempted_at")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_push_deliveries_subscription_kind_dedupe"
        ON "push_notification_deliveries" ("subscription_id", "kind", "dedupe_key")
        WHERE "dedupe_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_push_deliveries_subscription_kind_dedupe"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_push_deliveries_subscription_attempted"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_push_deliveries_user_attempted"
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "push_notification_deliveries"`,
    );

    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_push_subscriptions_provider_token_hash"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_push_subscriptions_provider_endpoint_hash"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_push_subscriptions_user_active"
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "push_notification_subscriptions"`,
    );
  }
}
