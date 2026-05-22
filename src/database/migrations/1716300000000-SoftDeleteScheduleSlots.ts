import { MigrationInterface, QueryRunner } from 'typeorm';

export class SoftDeleteScheduleSlots1716300000000 implements MigrationInterface {
  name = 'SoftDeleteScheduleSlots1716300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "schedule_slots"
        ADD "deleted_at" timestamptz
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_schedule_slots_user_day_time"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_schedule_slots_user_day_time"
        ON "schedule_slots" ("user_id", "day_of_week", "slot_time")
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_schedule_slots_user_deleted"
        ON "schedule_slots" ("user_id", "deleted_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        DROP CONSTRAINT IF EXISTS "FK_suggestion_instances_slot"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        ADD CONSTRAINT "FK_suggestion_instances_slot"
        FOREIGN KEY ("slot_id")
        REFERENCES "schedule_slots" ("id")
        ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        DROP CONSTRAINT IF EXISTS "FK_suggestion_instances_slot"
    `);
    await queryRunner.query(`
      ALTER TABLE "suggestion_instances"
        ADD CONSTRAINT "FK_suggestion_instances_slot"
        FOREIGN KEY ("slot_id")
        REFERENCES "schedule_slots" ("id")
        ON DELETE NO ACTION
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_schedule_slots_user_deleted"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_schedule_slots_user_day_time"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_schedule_slots_user_day_time"
        ON "schedule_slots" ("user_id", "day_of_week", "slot_time")
    `);
    await queryRunner.query(`
      ALTER TABLE "schedule_slots"
        DROP COLUMN "deleted_at"
    `);
  }
}
