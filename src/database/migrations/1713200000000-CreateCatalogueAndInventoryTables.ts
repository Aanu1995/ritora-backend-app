import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogueAndInventoryTables1713200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalogue_products" (
        "id" varchar(26) NOT NULL,
        "brand" varchar(255) NOT NULL,
        "name" varchar(255) NOT NULL,
        "category" varchar(30) NOT NULL,
        "barcode" varchar(64),
        "brand_search" varchar(255) NOT NULL,
        "name_search" varchar(255) NOT NULL,
        "identity" jsonb NOT NULL,
        "guidance" jsonb NOT NULL,
        "manufacturer" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalogue_products" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_catalogue_products_barcode_unique"
      ON "catalogue_products" ("barcode")
      WHERE "barcode" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_catalogue_products_brand_search"
      ON "catalogue_products" ("brand_search")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_catalogue_products_name_search"
      ON "catalogue_products" ("name_search")
    `);

    await queryRunner.query(`
      CREATE TABLE "inventory_products" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "catalogue_product_id" varchar(26),
        "brand" varchar(255) NOT NULL,
        "name" varchar(255) NOT NULL,
        "category" varchar(30) NOT NULL,
        "barcode" varchar(64),
        "status" varchar(30) NOT NULL DEFAULT 'active',
        "provenance" varchar(30) NOT NULL,
        "brand_search" varchar(255) NOT NULL,
        "name_search" varchar(255) NOT NULL,
        "opened_at" timestamptz,
        "expires_at" timestamptz,
        "period_after_opening_months" integer,
        "effective_expires_at" timestamptz,
        "identity" jsonb NOT NULL,
        "guidance" jsonb NOT NULL,
        "manufacturer" jsonb NOT NULL,
        "user_fields" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_products" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventory_products_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inventory_products_catalogue" FOREIGN KEY ("catalogue_product_id")
          REFERENCES "catalogue_products" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_inventory_products_user_created"
      ON "inventory_products" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_inventory_products_user_status"
      ON "inventory_products" ("user_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_inventory_products_user_brand"
      ON "inventory_products" ("user_id", "brand_search")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_inventory_products_user_name"
      ON "inventory_products" ("user_id", "name_search")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_inventory_products_user_effective_expires"
      ON "inventory_products" ("user_id", "effective_expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "inventory_products"`);
    await queryRunner.query(`DROP TABLE "catalogue_products"`);
  }
}
