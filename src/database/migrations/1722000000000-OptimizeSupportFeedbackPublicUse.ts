import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeSupportFeedbackPublicUse1722000000000 implements MigrationInterface {
  name = 'OptimizeSupportFeedbackPublicUse1722000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_user_created"
      ON "support_feedback_items" ("user_id", "created_at" DESC)
      WHERE "user_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_title_trgm"
      ON "support_feedback_items"
      USING gin ("title" gin_trgm_ops)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_feedback_reporter_email_trgm"
      ON "support_feedback_items"
      USING gin ("reporter_email" gin_trgm_ops)
      WHERE "reporter_email" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_support_feedback_reporter_email_trgm"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_support_feedback_title_trgm"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_support_feedback_user_created"',
    );
  }
}
