import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIngredientTables1713900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ingredient_entries" (
        "slug" varchar(64) NOT NULL,
        "category" varchar(32) NOT NULL,
        "display_name_en" varchar(128) NOT NULL,
        "summary_en" text NOT NULL,
        "ph_min" numeric(3,1),
        "ph_max" numeric(3,1),
        "ph_sensitive" boolean NOT NULL DEFAULT false,
        "photosensitizing" boolean NOT NULL DEFAULT false,
        "requires_spf" boolean NOT NULL DEFAULT false,
        "irritation_risk" boolean NOT NULL DEFAULT false,
        "overlap_severity" varchar(8) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingredient_entries" PRIMARY KEY ("slug"),
        CONSTRAINT "CK_ingredient_entries_overlap_severity" CHECK (
          "overlap_severity" IN ('low','medium','high')
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "ingredient_aliases" (
        "ingredient_slug" varchar(64) NOT NULL,
        "alias_slug" varchar(128) NOT NULL,
        CONSTRAINT "PK_ingredient_aliases" PRIMARY KEY ("ingredient_slug","alias_slug"),
        CONSTRAINT "FK_ingredient_aliases_ingredient" FOREIGN KEY ("ingredient_slug")
          REFERENCES "ingredient_entries" ("slug") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_ingredient_aliases_alias"
        ON "ingredient_aliases" ("alias_slug")
    `);

    await queryRunner.query(`
      CREATE TABLE "ingredient_category_patterns" (
        "ingredient_slug" varchar(64) NOT NULL,
        "pattern" text NOT NULL,
        CONSTRAINT "PK_ingredient_category_patterns" PRIMARY KEY ("ingredient_slug","pattern"),
        CONSTRAINT "FK_ingredient_category_patterns_ingredient" FOREIGN KEY ("ingredient_slug")
          REFERENCES "ingredient_entries" ("slug") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "ingredient_conflict_rules" (
        "code" varchar(64) NOT NULL,
        "severity" varchar(8) NOT NULL,
        "left_categories" varchar(32) ARRAY,
        "left_ingredient_slugs" varchar(64) ARRAY,
        "right_categories" varchar(32) ARRAY,
        "right_ingredient_slugs" varchar(64) ARRAY,
        "description_en" text NOT NULL,
        "mitigation_en" text,
        "conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "only_when_vitamin_c_is_ph_sensitive" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingredient_conflict_rules" PRIMARY KEY ("code"),
        CONSTRAINT "CK_ingredient_conflict_rules_severity" CHECK (
          "severity" IN ('low','medium','high')
        ),
        CONSTRAINT "CK_ingredient_conflict_rules_sides" CHECK (
          ("left_categories" IS NOT NULL AND array_length("left_categories", 1) > 0)
          OR ("left_ingredient_slugs" IS NOT NULL AND array_length("left_ingredient_slugs", 1) > 0)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "ingredient_translation_cache" (
        "source_hash" char(64) NOT NULL,
        "language" varchar(8) NOT NULL,
        "translated_text" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingredient_translation_cache" PRIMARY KEY ("source_hash","language"),
        CONSTRAINT "CK_ingredient_translation_cache_language" CHECK (
          "language" ~ '^[a-z]{2}(-[A-Z]{2})?$'
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_ingredient_translation_cache_language"
        ON "ingredient_translation_cache" ("language")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ingredient_translation_cache"`);
    await queryRunner.query(`DROP TABLE "ingredient_conflict_rules"`);
    await queryRunner.query(`DROP TABLE "ingredient_category_patterns"`);
    await queryRunner.query(`DROP TABLE "ingredient_aliases"`);
    await queryRunner.query(`DROP TABLE "ingredient_entries"`);
  }
}
