import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenAccountDeletionUserDataCascade1718000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "push_notification_deliveries" delivery
      WHERE NOT EXISTS (
        SELECT 1 FROM "users" "user" WHERE "user"."id" = delivery."user_id"
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "push_notification_deliveries"
        DROP CONSTRAINT IF EXISTS "FK_push_deliveries_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "push_notification_deliveries"
        ADD CONSTRAINT "FK_push_deliveries_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      DELETE FROM "skin_journal_media_deletion_jobs" job
      WHERE job."user_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "users" "user" WHERE "user"."id" = job."user_id"
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "skin_journal_media_deletion_jobs"
        DROP CONSTRAINT IF EXISTS "FK_skin_journal_media_deletion_jobs_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "skin_journal_media_deletion_jobs"
        ADD CONSTRAINT "FK_skin_journal_media_deletion_jobs_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "skin_journal_media_deletion_jobs"
        DROP CONSTRAINT IF EXISTS "FK_skin_journal_media_deletion_jobs_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "skin_journal_media_deletion_jobs"
        ADD CONSTRAINT "FK_skin_journal_media_deletion_jobs_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "push_notification_deliveries"
        DROP CONSTRAINT IF EXISTS "FK_push_deliveries_user"
    `);
  }
}
