import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceSingleAdminSession1719400000000 implements MigrationInterface {
  name = 'EnforceSingleAdminSession1719400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "admin_sessions" AS stale
      SET "revoked_at" = NOW()
      WHERE stale."revoked_at" IS NULL
        AND stale."id" NOT IN (
          SELECT latest."id"
          FROM (
            SELECT DISTINCT ON ("admin_id") "id"
            FROM "admin_sessions"
            WHERE "revoked_at" IS NULL
            ORDER BY "admin_id", "last_used_at" DESC, "created_at" DESC, "id" DESC
          ) AS latest
        )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_admin_sessions_single_active_session"
      ON "admin_sessions" ("admin_id")
      WHERE "revoked_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_admin_sessions_single_active_session"
    `);
  }
}
