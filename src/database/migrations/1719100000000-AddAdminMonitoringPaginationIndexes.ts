import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminMonitoringPaginationIndexes1719100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_monitoring_created_at_id_desc"
      ON "users" ("created_at" DESC, "id" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_monitoring_restricted_created_at_id_desc"
      ON "users" ("created_at" DESC, "id" DESC)
      WHERE "account_restricted_at" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_monitoring_unrestricted_created_at_id_desc"
      ON "users" ("created_at" DESC, "id" DESC)
      WHERE "account_restricted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_accounts_active_created_at_id_asc"
      ON "admin_accounts" ("created_at" ASC, "id" ASC)
      WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_accounts_active_created_at_id_asc"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_monitoring_unrestricted_created_at_id_desc"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_monitoring_restricted_created_at_id_desc"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_monitoring_created_at_id_desc"`,
    );
  }
}
