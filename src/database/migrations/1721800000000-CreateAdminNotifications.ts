import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminNotifications1721800000000 implements MigrationInterface {
  name = 'CreateAdminNotifications1721800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_notifications" (
        "id" varchar(26) NOT NULL,
        "admin_id" varchar(26) NOT NULL,
        "type" varchar(80) NOT NULL,
        "severity" varchar(20) NOT NULL,
        "title" varchar(160) NOT NULL,
        "body" text NOT NULL,
        "action_url" varchar(240),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_admin_notifications_severity" CHECK (
          "severity" IN ('info', 'warning', 'critical')
        ),
        CONSTRAINT "FK_admin_notifications_admin" FOREIGN KEY ("admin_id")
          REFERENCES "admin_accounts" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_notifications_admin_created"
      ON "admin_notifications" ("admin_id", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_notifications_admin_read"
      ON "admin_notifications" ("admin_id", "read_at", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_notifications_admin_unread_created"
      ON "admin_notifications" ("admin_id", "created_at" DESC, "id" DESC)
      WHERE "read_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_notifications_admin_unread_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_notifications_admin_read"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_notifications_admin_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_notifications"`);
  }
}
