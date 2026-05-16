import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSkinJournalEntryPhotos1718200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "skin_journal_entry_photos" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "entry_id" varchar(26) NOT NULL,
        "angle" varchar(20) NOT NULL,
        "photo_object_key" text NOT NULL,
        "photo_width" integer,
        "photo_height" integer,
        "photo_size" integer,
        "photo_content_type" varchar(40),
        "exif_stripped" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skin_journal_entry_photos" PRIMARY KEY ("id"),
        CONSTRAINT "FK_skin_journal_entry_photos_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_skin_journal_entry_photos_entry" FOREIGN KEY ("entry_id")
          REFERENCES "skin_journal_entries" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_skin_journal_entry_photos_angle" CHECK (
          "angle" IN ('head_on','left_profile','right_profile')
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_skin_journal_entry_photos_entry_angle"
        ON "skin_journal_entry_photos" ("entry_id", "angle")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_entry_photos_user_entry"
        ON "skin_journal_entry_photos" ("user_id", "entry_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_skin_journal_entry_photos_user_angle"
        ON "skin_journal_entry_photos" ("user_id", "angle")
    `);

    await queryRunner.query(`
      INSERT INTO "skin_journal_entry_photos" (
        "id",
        "user_id",
        "entry_id",
        "angle",
        "photo_object_key",
        "photo_width",
        "photo_height",
        "photo_size",
        "photo_content_type",
        "exif_stripped",
        "created_at",
        "updated_at"
      )
      SELECT
        "id",
        "user_id",
        "id",
        'head_on',
        "photo_object_key",
        "photo_width",
        "photo_height",
        "photo_size",
        "photo_content_type",
        "exif_stripped",
        "created_at",
        "updated_at"
      FROM "skin_journal_entries"
      WHERE "photo_object_key" IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "skin_journal_entry_photos"`);
  }
}
