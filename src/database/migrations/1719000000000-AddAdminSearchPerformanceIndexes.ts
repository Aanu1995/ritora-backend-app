import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminSearchPerformanceIndexes1719000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_accounts_search_email_trgm_active"
      ON "admin_accounts"
      USING gin ("canonical_email" gin_trgm_ops)
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_accounts_search_name_trgm_active"
      ON "admin_accounts"
      USING gin ("name" gin_trgm_ops)
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_search_email_trgm"
      ON "users"
      USING gin ("canonical_email" gin_trgm_ops)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_search_first_name_trgm"
      ON "users"
      USING gin ("first_name" gin_trgm_ops)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_search_last_name_trgm"
      ON "users"
      USING gin ("last_name" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_search_last_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_search_first_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_search_email_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_accounts_search_name_trgm_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_admin_accounts_search_email_trgm_active"`,
    );
  }
}
