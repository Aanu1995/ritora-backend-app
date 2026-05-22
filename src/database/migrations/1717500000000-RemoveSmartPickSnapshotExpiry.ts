import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveSmartPickSnapshotExpiry1717500000000 implements MigrationInterface {
  name = 'RemoveSmartPickSnapshotExpiry1717500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_smart_pick_snapshots_expires_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_snapshots"
        DROP COLUMN IF EXISTS "expires_at"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "smart_pick_snapshots"
        ADD COLUMN IF NOT EXISTS "expires_at" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "smart_pick_snapshots"
      SET "expires_at" = 'infinity'::timestamptz
      WHERE "expires_at" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_pick_snapshots"
        ALTER COLUMN "expires_at" SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_smart_pick_snapshots_expires_at"
        ON "smart_pick_snapshots" ("expires_at")
    `);
  }
}
