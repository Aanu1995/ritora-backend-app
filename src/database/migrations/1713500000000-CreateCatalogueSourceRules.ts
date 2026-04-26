import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogueSourceRules1713500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "catalogue_source_rules" (
        "id" varchar(26) PRIMARY KEY,
        "label" varchar(100) NOT NULL,
        "host_pattern" varchar(255) NOT NULL,
        "match_type" varchar(30) NOT NULL,
        "effect" varchar(20) NOT NULL,
        "score_adjustment" integer NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT true,
        "notes" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_catalogue_source_rules_enabled"
      ON "catalogue_source_rules" ("enabled")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalogue_source_rules_label"
      ON "catalogue_source_rules" ("label")
    `);

    await queryRunner.query(`
      INSERT INTO "catalogue_source_rules" (
        "id",
        "label",
        "host_pattern",
        "match_type",
        "effect",
        "score_adjustment",
        "enabled",
        "notes"
      )
      VALUES
        ('01JS7RTRULE000000000000001', 'amazon-retailer', 'amazon.', 'hostname_contains', 'block', 0, true, 'Marketplace product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000002', 'walmart-retailer', 'walmart.', 'hostname_contains', 'block', 0, true, 'Retailer product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000003', 'target-retailer', 'target.', 'hostname_contains', 'block', 0, true, 'Retailer product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000004', 'ebay-marketplace', 'ebay.', 'hostname_contains', 'block', 0, true, 'Marketplace product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000005', 'boots-retailer', 'boots.', 'hostname_contains', 'block', 0, true, 'Retailer product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000006', 'sephora-retailer', 'sephora.', 'hostname_contains', 'block', 0, true, 'Retailer product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000007', 'ulta-retailer', 'ulta.', 'hostname_contains', 'block', 0, true, 'Retailer product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000008', 'lookfantastic-retailer', 'lookfantastic.', 'hostname_contains', 'block', 0, true, 'Retailer product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000009', 'stylevana-retailer', 'stylevana.', 'hostname_contains', 'block', 0, true, 'Retailer product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000010', 'yesstyle-retailer', 'yesstyle.', 'hostname_contains', 'block', 0, true, 'Retailer product pages are not treated as official sources'),
        ('01JS7RTRULE000000000000011', 'reddit-community', 'reddit.com', 'hostname_suffix', 'block', 0, true, 'Community discussion pages are not official product sources'),
        ('01JS7RTRULE000000000000012', 'facebook-social', 'facebook.com', 'hostname_suffix', 'block', 0, true, 'Social media pages are not official product sources'),
        ('01JS7RTRULE000000000000013', 'instagram-social', 'instagram.com', 'hostname_suffix', 'block', 0, true, 'Social media pages are not official product sources'),
        ('01JS7RTRULE000000000000014', 'tiktok-social', 'tiktok.com', 'hostname_suffix', 'block', 0, true, 'Social media pages are not official product sources'),
        ('01JS7RTRULE000000000000015', 'youtube-social', 'youtube.com', 'hostname_suffix', 'block', 0, true, 'Video pages are not official product sources'),
        ('01JS7RTRULE000000000000016', 'skincarisma-informational', 'skincarisma.', 'hostname_contains', 'penalize', -80, true, 'Ingredient databases can help context but should not outrank product pages'),
        ('01JS7RTRULE000000000000017', 'skinsort-informational', 'skinsort.', 'hostname_contains', 'penalize', -80, true, 'Ingredient databases can help context but should not outrank product pages'),
        ('01JS7RTRULE000000000000018', 'incidecoder-informational', 'incidecoder.', 'hostname_contains', 'penalize', -80, true, 'Ingredient databases can help context but should not outrank product pages'),
        ('01JS7RTRULE000000000000019', 'cosdna-informational', 'cosdna.', 'hostname_contains', 'penalize', -80, true, 'Ingredient databases can help context but should not outrank product pages')
      ON CONFLICT ("label") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_catalogue_source_rules_label"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_catalogue_source_rules_enabled"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "catalogue_source_rules"`);
  }
}
