import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeRoutineMemoryProductUsageIndexes1724400000000 implements MigrationInterface {
  public readonly transaction = false;

  name = 'OptimizeRoutineMemoryProductUsageIndexes1724400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_application_items_inventory_product_usage"
      ON "application_log_items" ("inventory_product_id", "status", "application_log_id")
      WHERE "inventory_product_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_application_items_substituted_product_usage"
      ON "application_log_items" ("substituted_with_product_id", "status", "application_log_id")
      WHERE "substituted_with_product_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_application_items_substituted_product_usage"',
    );
    await queryRunner.query(
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_application_items_inventory_product_usage"',
    );
  }
}
