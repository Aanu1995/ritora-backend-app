import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendCatalogueDiscoveryCache1713400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalogue_products"
      ADD COLUMN IF NOT EXISTS "source_type" varchar(50) NOT NULL DEFAULT 'ritora-catalogue',
      ADD COLUMN IF NOT EXISTS "source_id" varchar(255),
      ADD COLUMN IF NOT EXISTS "source_url" varchar(2048),
      ADD COLUMN IF NOT EXISTS "confidence" varchar(20) NOT NULL DEFAULT 'high',
      ADD COLUMN IF NOT EXISTS "review_required" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "raw_source" jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "last_synced_at" timestamptz
    `);

    await queryRunner.query(`
      UPDATE "catalogue_products"
      SET
        "source_type" = 'ritora-catalogue',
        "confidence" = 'high',
        "review_required" = false,
        "warnings" = '[]'::jsonb
      WHERE "source_type" IS NULL
         OR "confidence" IS NULL
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_catalogue_products_source_url"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_catalogue_products_source_type_source_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "catalogue_products"
      DROP COLUMN IF EXISTS "last_synced_at",
      DROP COLUMN IF EXISTS "raw_source",
      DROP COLUMN IF EXISTS "warnings",
      DROP COLUMN IF EXISTS "review_required",
      DROP COLUMN IF EXISTS "confidence",
      DROP COLUMN IF EXISTS "source_url",
      DROP COLUMN IF EXISTS "source_id",
      DROP COLUMN IF EXISTS "source_type"
    `);
  }
}
