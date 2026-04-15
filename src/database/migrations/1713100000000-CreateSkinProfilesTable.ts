import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSkinProfilesTable1713100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "skin_profiles" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "skin_type" varchar(20),
        "skin_tone" varchar(30),
        "age_range" varchar(10),
        "ethnicity" varchar(30),
        "current_concerns" jsonb NOT NULL DEFAULT '[]',
        "known_sensitivities" jsonb NOT NULL DEFAULT '[]',
        "skin_goals" jsonb NOT NULL DEFAULT '[]',
        "country_code" varchar(2),
        "city" varchar(100),
        "routine_complexity" varchar(20),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_skin_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_skin_profiles_user_id" UNIQUE ("user_id"),
        CONSTRAINT "FK_skin_profiles_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "skin_profiles"`);
  }
}
