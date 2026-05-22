import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationReadRetentionIndex1716800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_in_app_notifications_read_retention"
        ON "in_app_notifications" ("kind", "read_at")
        WHERE "read_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_in_app_notifications_read_retention"`,
    );
  }
}
