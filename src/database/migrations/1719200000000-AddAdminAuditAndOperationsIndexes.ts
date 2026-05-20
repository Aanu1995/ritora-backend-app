import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminAuditAndOperationsIndexes1719200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_created_at_id_desc"
      ON "admin_audit_logs" ("created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_action_created_at_id_desc"
      ON "admin_audit_logs" ("action", "created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_export_jobs_status_created"
      ON "skin_journal_export_jobs" ("status", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_data_access_logs_user_created"
      ON "user_data_access_logs" ("user_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_data_access_logs_user_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_export_jobs_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_audit_logs_action_created_at_id_desc"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_audit_logs_created_at_id_desc"`,
    );
  }
}
