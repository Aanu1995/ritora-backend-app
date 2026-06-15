import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecoveryModeFields1724000000000 implements MigrationInterface {
  name = 'AddRecoveryModeFields1724000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "routine_simplification_events"
        ADD COLUMN IF NOT EXISTS "recovery_phase" varchar(30) NOT NULL DEFAULT 'stabilize',
        ADD COLUMN IF NOT EXISTS "recovery_trigger_source" varchar(30) NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS "recovery_trigger_symptoms" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "recovery_trigger_severity" varchar(20) NULL,
        ADD COLUMN IF NOT EXISTS "recovery_active_overuse" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "recovery_review_after" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "recovery_exit_eligible_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "recovery_return_step" varchar(30) NOT NULL DEFAULT 'not_started'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "routine_simplification_events"
        DROP COLUMN IF EXISTS "recovery_return_step",
        DROP COLUMN IF EXISTS "recovery_exit_eligible_at",
        DROP COLUMN IF EXISTS "recovery_review_after",
        DROP COLUMN IF EXISTS "recovery_active_overuse",
        DROP COLUMN IF EXISTS "recovery_trigger_severity",
        DROP COLUMN IF EXISTS "recovery_trigger_symptoms",
        DROP COLUMN IF EXISTS "recovery_trigger_source",
        DROP COLUMN IF EXISTS "recovery_phase"
    `);
  }
}
