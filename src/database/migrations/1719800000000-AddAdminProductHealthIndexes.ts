import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminProductHealthIndexes1719800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_created_at"
      ON "users" ("created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_auth_sessions_last_used_active"
      ON "auth_sessions" ("last_used_at", "user_id")
      WHERE "revoked_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_entries_created_user"
      ON "skin_journal_entries" ("created_at", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_skin_journal_entries_analysis_started"
      ON "skin_journal_entries" ("analysis_started_at")
      WHERE "analysis_started_at" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_inventory_products_created_user"
      ON "inventory_products" ("created_at", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_schedule_slots_active_user"
      ON "schedule_slots" ("user_id")
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_suggestion_instances_status_user"
      ON "suggestion_instances" ("generation_status", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_suggestion_instances_generated_status"
      ON "suggestion_instances" ("generated_at", "generation_status")
      WHERE "generated_at" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_application_logs_created_user"
      ON "application_logs" ("created_at", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_smart_pick_snapshots_user"
      ON "smart_pick_snapshots" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_smart_pick_snapshots_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_application_logs_created_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suggestion_instances_generated_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suggestion_instances_status_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_schedule_slots_active_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_inventory_products_created_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_entries_analysis_started"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skin_journal_entries_created_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_auth_sessions_last_used_active"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_created_at"`);
  }
}
