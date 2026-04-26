import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenCatalogueInventorySearch1713300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(`
      ALTER TABLE "inventory_products"
      ADD COLUMN IF NOT EXISTS "search_document" text NOT NULL DEFAULT ''
    `);

    await queryRunner.query(`
      UPDATE "inventory_products"
      SET "search_document" = LOWER(
        CONCAT_WS(
          ' ',
          "brand",
          "name",
          "category",
          COALESCE("identity"->>'description', ''),
          COALESCE("manufacturer"->>'brand', ''),
          COALESCE("manufacturer"->>'parentCompany', ''),
          COALESCE("user_fields"->>'purchasedFrom', '')
        )
      )
      WHERE "search_document" = ''
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_catalogue_products_brand_search_trgm"
      ON "catalogue_products"
      USING gin ("brand_search" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_catalogue_products_name_search_trgm"
      ON "catalogue_products"
      USING gin ("name_search" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_catalogue_products_product_url_lookup"
      ON "catalogue_products" (
        LOWER(REGEXP_REPLACE(COALESCE("manufacturer"->>'productUrl', ''), '/+$', ''))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_products_search_document_trgm"
      ON "inventory_products"
      USING gin ("search_document" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_products_user_created_id"
      ON "inventory_products" ("user_id", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_products_user_name_id"
      ON "inventory_products" ("user_id", "name_search" ASC, "id" ASC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_products_user_category_name_id"
      ON "inventory_products" ("user_id", "category" ASC, "name_search" ASC, "id" ASC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_products_user_effective_expires_id"
      ON "inventory_products" ("user_id", "effective_expires_at" ASC, "id" ASC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_inventory_products_user_effective_expires_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_inventory_products_user_category_name_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_inventory_products_user_name_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_inventory_products_user_created_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_inventory_products_search_document_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_catalogue_products_product_url_lookup"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_catalogue_products_name_search_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_catalogue_products_brand_search_trgm"`,
    );
    await queryRunner.query(`
      ALTER TABLE "inventory_products"
      DROP COLUMN IF EXISTS "search_document"
    `);
  }
}
