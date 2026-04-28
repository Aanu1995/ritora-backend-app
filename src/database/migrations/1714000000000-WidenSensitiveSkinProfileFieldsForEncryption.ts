import { MigrationInterface, QueryRunner } from 'typeorm';
import type { ValueTransformer } from 'typeorm';
import {
  encryptedBooleanFieldTransformer,
  encryptedJsonFieldTransformer,
  encryptedNullableStringFieldTransformer,
} from '../../skin-profile/skin-profile-field-encryption';

type UserSkinProfileRow = {
  id: string;
  date_of_birth: unknown;
  sex_at_birth: unknown;
};

type SkinProfileSensitiveRow = {
  id: string;
  skin_type: unknown;
  skin_tone: unknown;
  ethnicity: unknown;
  current_concerns: unknown;
  country_code: unknown;
  city: unknown;
  fitzpatrick_phototype: unknown;
  sensitivity_level: unknown;
  hydration_level: unknown;
  primary_goal: unknown;
  pregnancy_status: unknown;
  under_dermatologist_care: unknown;
  allow_smart_picks: unknown;
  budget_tier: unknown;
  safety_context: unknown;
  reaction_history: unknown;
  concern_details: unknown;
  skin_behavior: unknown;
  active_tolerances: unknown;
  routine_preferences: unknown;
  lifestyle_context: unknown;
  shopping_preferences: unknown;
  hormonal_context: unknown;
};

const userFieldTransformers = {
  date_of_birth: encryptedNullableStringFieldTransformer('users.date_of_birth'),
  sex_at_birth: encryptedNullableStringFieldTransformer('users.sex_at_birth'),
};

const skinProfileStringTransformers = {
  skin_type: encryptedNullableStringFieldTransformer('skin_profiles.skin_type'),
  skin_tone: encryptedNullableStringFieldTransformer('skin_profiles.skin_tone'),
  ethnicity: encryptedNullableStringFieldTransformer('skin_profiles.ethnicity'),
  country_code: encryptedNullableStringFieldTransformer(
    'skin_profiles.country_code',
  ),
  city: encryptedNullableStringFieldTransformer('skin_profiles.city'),
  fitzpatrick_phototype: encryptedNullableStringFieldTransformer(
    'skin_profiles.fitzpatrick_phototype',
  ),
  sensitivity_level: encryptedNullableStringFieldTransformer(
    'skin_profiles.sensitivity_level',
  ),
  hydration_level: encryptedNullableStringFieldTransformer(
    'skin_profiles.hydration_level',
  ),
  primary_goal: encryptedNullableStringFieldTransformer(
    'skin_profiles.primary_goal',
  ),
  pregnancy_status: encryptedNullableStringFieldTransformer(
    'skin_profiles.pregnancy_status',
    ['string'],
  ),
  under_dermatologist_care: encryptedNullableStringFieldTransformer(
    'skin_profiles.under_dermatologist_care',
    ['string'],
  ),
  budget_tier: encryptedNullableStringFieldTransformer(
    'skin_profiles.budget_tier',
  ),
};

const allowSmartPicksTransformer = encryptedBooleanFieldTransformer(
  'skin_profiles.allow_smart_picks',
  true,
);

const skinProfileJsonTransformers = {
  current_concerns: encryptedJsonFieldTransformer<string[]>(
    'skin_profiles.current_concerns',
    [],
  ),
  safety_context: encryptedJsonFieldTransformer<Record<string, unknown>>(
    'skin_profiles.safety_context',
    {},
    ['safety-context'],
  ),
  reaction_history: encryptedJsonFieldTransformer<Record<string, unknown>>(
    'skin_profiles.reaction_history',
    {},
  ),
  concern_details: encryptedJsonFieldTransformer<Record<string, unknown>>(
    'skin_profiles.concern_details',
    {},
  ),
  skin_behavior: encryptedJsonFieldTransformer<Record<string, unknown>>(
    'skin_profiles.skin_behavior',
    {},
  ),
  active_tolerances: encryptedJsonFieldTransformer<Record<string, unknown>>(
    'skin_profiles.active_tolerances',
    {},
  ),
  routine_preferences: encryptedJsonFieldTransformer<Record<string, unknown>>(
    'skin_profiles.routine_preferences',
    {},
  ),
  lifestyle_context: encryptedJsonFieldTransformer<Record<string, unknown>>(
    'skin_profiles.lifestyle_context',
    {},
  ),
  shopping_preferences: encryptedJsonFieldTransformer<Record<string, unknown>>(
    'skin_profiles.shopping_preferences',
    {},
  ),
  hormonal_context: encryptedJsonFieldTransformer<Record<string, unknown>>(
    'skin_profiles.hormonal_context',
    {},
    ['hormonal-context'],
  ),
};

function encryptStoredValue(
  transformer: ValueTransformer,
  value: unknown,
): unknown {
  return transformer.to(transformer.from(value));
}

function decryptStoredValue(
  transformer: ValueTransformer,
  value: unknown,
): unknown {
  return transformer.from(value);
}

function jsonbParameter(value: unknown): string {
  return JSON.stringify(value);
}

export class WidenSensitiveSkinProfileFieldsForEncryption1714000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "date_of_birth" TYPE text USING "date_of_birth"::text,
      ALTER COLUMN "sex_at_birth" TYPE text
    `);

    await queryRunner.query(`
      ALTER TABLE "skin_profiles"
      ALTER COLUMN "skin_type" TYPE text,
      ALTER COLUMN "skin_tone" TYPE text,
      ALTER COLUMN "ethnicity" TYPE text,
      ALTER COLUMN "country_code" TYPE text,
      ALTER COLUMN "city" TYPE text,
      ALTER COLUMN "fitzpatrick_phototype" TYPE text,
      ALTER COLUMN "sensitivity_level" TYPE text,
      ALTER COLUMN "hydration_level" TYPE text,
      ALTER COLUMN "primary_goal" TYPE text,
      ALTER COLUMN "pregnancy_status" TYPE text,
      ALTER COLUMN "under_dermatologist_care" TYPE text,
      ALTER COLUMN "budget_tier" TYPE text
    `);

    await queryRunner.query(`
      ALTER TABLE "skin_profiles"
      ALTER COLUMN "current_concerns" DROP DEFAULT,
      ALTER COLUMN "allow_smart_picks" DROP DEFAULT,
      ALTER COLUMN "allow_smart_picks" TYPE text USING "allow_smart_picks"::text,
      ALTER COLUMN "safety_context" DROP DEFAULT,
      ALTER COLUMN "reaction_history" DROP DEFAULT,
      ALTER COLUMN "concern_details" DROP DEFAULT,
      ALTER COLUMN "skin_behavior" DROP DEFAULT,
      ALTER COLUMN "active_tolerances" DROP DEFAULT,
      ALTER COLUMN "routine_preferences" DROP DEFAULT,
      ALTER COLUMN "lifestyle_context" DROP DEFAULT,
      ALTER COLUMN "shopping_preferences" DROP DEFAULT,
      ALTER COLUMN "hormonal_context" DROP DEFAULT
    `);

    await this.encryptUserFields(queryRunner);
    await this.encryptSkinProfileFields(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.decryptSkinProfileFields(queryRunner);
    await this.decryptUserFields(queryRunner);

    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "date_of_birth" TYPE date USING NULLIF("date_of_birth", '')::date,
      ALTER COLUMN "sex_at_birth" TYPE varchar(20)
    `);

    await queryRunner.query(`
      ALTER TABLE "skin_profiles"
      ALTER COLUMN "skin_type" TYPE varchar(20),
      ALTER COLUMN "skin_tone" TYPE varchar(30),
      ALTER COLUMN "ethnicity" TYPE varchar(30),
      ALTER COLUMN "country_code" TYPE varchar(2),
      ALTER COLUMN "city" TYPE varchar(100),
      ALTER COLUMN "fitzpatrick_phototype" TYPE varchar(4),
      ALTER COLUMN "sensitivity_level" TYPE varchar(20),
      ALTER COLUMN "hydration_level" TYPE varchar(20),
      ALTER COLUMN "primary_goal" TYPE varchar(40),
      ALTER COLUMN "pregnancy_status" TYPE varchar(30),
      ALTER COLUMN "under_dermatologist_care" TYPE varchar(30),
      ALTER COLUMN "budget_tier" TYPE varchar(20),
      ALTER COLUMN "allow_smart_picks" TYPE boolean USING "allow_smart_picks"::boolean,
      ALTER COLUMN "current_concerns" SET DEFAULT '[]'::jsonb,
      ALTER COLUMN "allow_smart_picks" SET DEFAULT true,
      ALTER COLUMN "safety_context" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "reaction_history" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "concern_details" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "skin_behavior" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "active_tolerances" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "routine_preferences" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "lifestyle_context" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "shopping_preferences" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "hormonal_context" SET DEFAULT '{}'::jsonb
    `);
  }

  private async encryptUserFields(queryRunner: QueryRunner): Promise<void> {
    const users = (await queryRunner.query(`
      SELECT "id", "date_of_birth", "sex_at_birth"
      FROM "users"
      WHERE "date_of_birth" IS NOT NULL OR "sex_at_birth" IS NOT NULL
    `)) as UserSkinProfileRow[];

    for (const user of users) {
      await queryRunner.query(
        `
          UPDATE "users"
          SET "date_of_birth" = $1, "sex_at_birth" = $2
          WHERE "id" = $3
        `,
        [
          encryptStoredValue(
            userFieldTransformers.date_of_birth,
            user.date_of_birth,
          ),
          encryptStoredValue(
            userFieldTransformers.sex_at_birth,
            user.sex_at_birth,
          ),
          user.id,
        ],
      );
    }
  }

  private async decryptUserFields(queryRunner: QueryRunner): Promise<void> {
    const users = (await queryRunner.query(`
      SELECT "id", "date_of_birth", "sex_at_birth"
      FROM "users"
      WHERE "date_of_birth" IS NOT NULL OR "sex_at_birth" IS NOT NULL
    `)) as UserSkinProfileRow[];

    for (const user of users) {
      await queryRunner.query(
        `
          UPDATE "users"
          SET "date_of_birth" = $1, "sex_at_birth" = $2
          WHERE "id" = $3
        `,
        [
          decryptStoredValue(
            userFieldTransformers.date_of_birth,
            user.date_of_birth,
          ),
          decryptStoredValue(
            userFieldTransformers.sex_at_birth,
            user.sex_at_birth,
          ),
          user.id,
        ],
      );
    }
  }

  private async encryptSkinProfileFields(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const profiles = (await queryRunner.query(`
      SELECT
        "id",
        "skin_type",
        "skin_tone",
        "ethnicity",
        "current_concerns",
        "country_code",
        "city",
        "fitzpatrick_phototype",
        "sensitivity_level",
        "hydration_level",
        "primary_goal",
        "pregnancy_status",
        "under_dermatologist_care",
        "allow_smart_picks",
        "budget_tier",
        "safety_context",
        "reaction_history",
        "concern_details",
        "skin_behavior",
        "active_tolerances",
        "routine_preferences",
        "lifestyle_context",
        "shopping_preferences",
        "hormonal_context"
      FROM "skin_profiles"
    `)) as SkinProfileSensitiveRow[];

    for (const profile of profiles) {
      await queryRunner.query(
        `
          UPDATE "skin_profiles"
          SET
            "skin_type" = $1,
            "skin_tone" = $2,
            "ethnicity" = $3,
            "current_concerns" = $4::jsonb,
            "country_code" = $5,
            "city" = $6,
            "fitzpatrick_phototype" = $7,
            "sensitivity_level" = $8,
            "hydration_level" = $9,
            "primary_goal" = $10,
            "pregnancy_status" = $11,
            "under_dermatologist_care" = $12,
            "allow_smart_picks" = $13,
            "budget_tier" = $14,
            "safety_context" = $15::jsonb,
            "reaction_history" = $16::jsonb,
            "concern_details" = $17::jsonb,
            "skin_behavior" = $18::jsonb,
            "active_tolerances" = $19::jsonb,
            "routine_preferences" = $20::jsonb,
            "lifestyle_context" = $21::jsonb,
            "shopping_preferences" = $22::jsonb,
            "hormonal_context" = $23::jsonb
          WHERE "id" = $24
        `,
        [
          encryptStoredValue(
            skinProfileStringTransformers.skin_type,
            profile.skin_type,
          ),
          encryptStoredValue(
            skinProfileStringTransformers.skin_tone,
            profile.skin_tone,
          ),
          encryptStoredValue(
            skinProfileStringTransformers.ethnicity,
            profile.ethnicity,
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.current_concerns,
              profile.current_concerns,
            ),
          ),
          encryptStoredValue(
            skinProfileStringTransformers.country_code,
            profile.country_code,
          ),
          encryptStoredValue(skinProfileStringTransformers.city, profile.city),
          encryptStoredValue(
            skinProfileStringTransformers.fitzpatrick_phototype,
            profile.fitzpatrick_phototype,
          ),
          encryptStoredValue(
            skinProfileStringTransformers.sensitivity_level,
            profile.sensitivity_level,
          ),
          encryptStoredValue(
            skinProfileStringTransformers.hydration_level,
            profile.hydration_level,
          ),
          encryptStoredValue(
            skinProfileStringTransformers.primary_goal,
            profile.primary_goal,
          ),
          encryptStoredValue(
            skinProfileStringTransformers.pregnancy_status,
            profile.pregnancy_status,
          ),
          encryptStoredValue(
            skinProfileStringTransformers.under_dermatologist_care,
            profile.under_dermatologist_care,
          ),
          encryptStoredValue(
            allowSmartPicksTransformer,
            profile.allow_smart_picks,
          ),
          encryptStoredValue(
            skinProfileStringTransformers.budget_tier,
            profile.budget_tier,
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.safety_context,
              profile.safety_context,
            ),
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.reaction_history,
              profile.reaction_history,
            ),
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.concern_details,
              profile.concern_details,
            ),
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.skin_behavior,
              profile.skin_behavior,
            ),
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.active_tolerances,
              profile.active_tolerances,
            ),
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.routine_preferences,
              profile.routine_preferences,
            ),
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.lifestyle_context,
              profile.lifestyle_context,
            ),
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.shopping_preferences,
              profile.shopping_preferences,
            ),
          ),
          jsonbParameter(
            encryptStoredValue(
              skinProfileJsonTransformers.hormonal_context,
              profile.hormonal_context,
            ),
          ),
          profile.id,
        ],
      );
    }
  }

  private async decryptSkinProfileFields(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const profiles = (await queryRunner.query(`
      SELECT
        "id",
        "skin_type",
        "skin_tone",
        "ethnicity",
        "current_concerns",
        "country_code",
        "city",
        "fitzpatrick_phototype",
        "sensitivity_level",
        "hydration_level",
        "primary_goal",
        "pregnancy_status",
        "under_dermatologist_care",
        "allow_smart_picks",
        "budget_tier",
        "safety_context",
        "reaction_history",
        "concern_details",
        "skin_behavior",
        "active_tolerances",
        "routine_preferences",
        "lifestyle_context",
        "shopping_preferences",
        "hormonal_context"
      FROM "skin_profiles"
    `)) as SkinProfileSensitiveRow[];

    for (const profile of profiles) {
      await queryRunner.query(
        `
          UPDATE "skin_profiles"
          SET
            "skin_type" = $1,
            "skin_tone" = $2,
            "ethnicity" = $3,
            "current_concerns" = $4::jsonb,
            "country_code" = $5,
            "city" = $6,
            "fitzpatrick_phototype" = $7,
            "sensitivity_level" = $8,
            "hydration_level" = $9,
            "primary_goal" = $10,
            "pregnancy_status" = $11,
            "under_dermatologist_care" = $12,
            "allow_smart_picks" = $13,
            "budget_tier" = $14,
            "safety_context" = $15::jsonb,
            "reaction_history" = $16::jsonb,
            "concern_details" = $17::jsonb,
            "skin_behavior" = $18::jsonb,
            "active_tolerances" = $19::jsonb,
            "routine_preferences" = $20::jsonb,
            "lifestyle_context" = $21::jsonb,
            "shopping_preferences" = $22::jsonb,
            "hormonal_context" = $23::jsonb
          WHERE "id" = $24
        `,
        [
          decryptStoredValue(
            skinProfileStringTransformers.skin_type,
            profile.skin_type,
          ),
          decryptStoredValue(
            skinProfileStringTransformers.skin_tone,
            profile.skin_tone,
          ),
          decryptStoredValue(
            skinProfileStringTransformers.ethnicity,
            profile.ethnicity,
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.current_concerns,
              profile.current_concerns,
            ),
          ),
          decryptStoredValue(
            skinProfileStringTransformers.country_code,
            profile.country_code,
          ),
          decryptStoredValue(skinProfileStringTransformers.city, profile.city),
          decryptStoredValue(
            skinProfileStringTransformers.fitzpatrick_phototype,
            profile.fitzpatrick_phototype,
          ),
          decryptStoredValue(
            skinProfileStringTransformers.sensitivity_level,
            profile.sensitivity_level,
          ),
          decryptStoredValue(
            skinProfileStringTransformers.hydration_level,
            profile.hydration_level,
          ),
          decryptStoredValue(
            skinProfileStringTransformers.primary_goal,
            profile.primary_goal,
          ),
          decryptStoredValue(
            skinProfileStringTransformers.pregnancy_status,
            profile.pregnancy_status,
          ),
          decryptStoredValue(
            skinProfileStringTransformers.under_dermatologist_care,
            profile.under_dermatologist_care,
          ),
          decryptStoredValue(
            allowSmartPicksTransformer,
            profile.allow_smart_picks,
          ),
          decryptStoredValue(
            skinProfileStringTransformers.budget_tier,
            profile.budget_tier,
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.safety_context,
              profile.safety_context,
            ),
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.reaction_history,
              profile.reaction_history,
            ),
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.concern_details,
              profile.concern_details,
            ),
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.skin_behavior,
              profile.skin_behavior,
            ),
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.active_tolerances,
              profile.active_tolerances,
            ),
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.routine_preferences,
              profile.routine_preferences,
            ),
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.lifestyle_context,
              profile.lifestyle_context,
            ),
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.shopping_preferences,
              profile.shopping_preferences,
            ),
          ),
          jsonbParameter(
            decryptStoredValue(
              skinProfileJsonTransformers.hormonal_context,
              profile.hormonal_context,
            ),
          ),
          profile.id,
        ],
      );
    }
  }
}
