import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpecialistMetadataToScheduleSlots1715700000000 implements MigrationInterface {
  name = 'AddSpecialistMetadataToScheduleSlots1715700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "schedule_slots"
        ADD COLUMN "specialist_provider_name" text,
        ADD COLUMN "specialist_clinic_name" text,
        ADD COLUMN "specialist_active_since" date,
        ADD COLUMN "specialist_safety_notes" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "schedule_slots"
        DROP COLUMN "specialist_safety_notes",
        DROP COLUMN "specialist_active_since",
        DROP COLUMN "specialist_clinic_name",
        DROP COLUMN "specialist_provider_name"
    `);
  }
}
