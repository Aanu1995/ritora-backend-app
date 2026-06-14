import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductIntroductionLifecycle1724100000000 implements MigrationInterface {
  public readonly transaction = false;

  name = 'AddProductIntroductionLifecycle1724100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inventory_products"
        ADD COLUMN IF NOT EXISTS "introduction_status" varchar(30) NULL,
        ADD COLUMN IF NOT EXISTS "introduction_started_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "introduction_status_updated_at" timestamptz NULL
    `);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_inventory_products_user_introduction_status"
        ON "inventory_products" ("user_id", "introduction_status")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_inventory_products_user_introduction_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "inventory_products"
        DROP COLUMN IF EXISTS "introduction_status_updated_at",
        DROP COLUMN IF EXISTS "introduction_started_at",
        DROP COLUMN IF EXISTS "introduction_status"
    `);
  }
}
