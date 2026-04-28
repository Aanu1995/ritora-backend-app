import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSkinProfilesTable1713100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "skin_profiles" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "skin_type" varchar(20),
        "skin_tone" varchar(30),
        "ethnicity" varchar(30),
        "current_concerns" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "country_code" varchar(2),
        "city" varchar(100),
        "fitzpatrick_phototype" varchar(4),
        "sensitivity_level" varchar(20),
        "hydration_level" varchar(20),
        "primary_goal" varchar(40),
        "pregnancy_status" varchar(30),
        "under_dermatologist_care" varchar(30),
        "allow_smart_picks" boolean NOT NULL DEFAULT true,
        "budget_tier" varchar(20),
        "safety_context" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "reaction_history" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "concern_details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "skin_behavior" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "active_tolerances" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "routine_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "lifestyle_context" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "shopping_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "hormonal_context" jsonb NOT NULL DEFAULT '{}'::jsonb,
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
