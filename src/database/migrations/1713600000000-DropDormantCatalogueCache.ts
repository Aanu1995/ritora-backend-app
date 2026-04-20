import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropDormantCatalogueCache1713600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inventory_products"
      DROP CONSTRAINT IF EXISTS "FK_inventory_products_catalogue"
    `);

    await queryRunner.query(`
      ALTER TABLE "inventory_products"
      DROP COLUMN IF EXISTS "catalogue_product_id"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "catalogue_products"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "catalogue_products" (
        "id" varchar(26) NOT NULL,
        "brand" varchar(255) NOT NULL,
        "name" varchar(255) NOT NULL,
        "category" varchar(50) NOT NULL,
        "barcode" varchar(64),
        "brand_search" varchar(255),
        "name_search" varchar(255),
        "source_type" varchar(50) NOT NULL DEFAULT 'ritora-catalogue',
        "source_id" varchar(255),
        "source_url" varchar(2048),
        "confidence" varchar(20) NOT NULL DEFAULT 'high',
        "review_required" boolean NOT NULL DEFAULT false,
        "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "raw_source" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "identity" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "guidance" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "manufacturer" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "last_synced_at" timestamptz,
        CONSTRAINT "PK_catalogue_products" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalogue_products_barcode_unique"
      ON "catalogue_products" ("barcode")
      WHERE "barcode" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_catalogue_products_brand_search"
      ON "catalogue_products" ("brand_search")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_catalogue_products_name_search"
      ON "catalogue_products" ("name_search")
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
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalogue_products_source_type_source_id"
      ON "catalogue_products" ("source_type", "source_id")
      WHERE "source_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_catalogue_products_source_url"
      ON "catalogue_products" ("source_url")
      WHERE "source_url" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "inventory_products"
      ADD COLUMN IF NOT EXISTS "catalogue_product_id" varchar(26)
    `);

    await queryRunner.query(`
      ALTER TABLE "inventory_products"
      ADD CONSTRAINT "FK_inventory_products_catalogue"
      FOREIGN KEY ("catalogue_product_id")
      REFERENCES "catalogue_products" ("id")
      ON DELETE SET NULL
    `);
  }
}
