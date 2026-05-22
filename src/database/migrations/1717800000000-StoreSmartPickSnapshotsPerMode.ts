import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreSmartPickSnapshotsPerMode1717800000000 implements MigrationInterface {
  name = 'StoreSmartPickSnapshotsPerMode1717800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_smart_pick_snapshots_user"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_smart_pick_snapshots_user_mode"
        ON "smart_pick_snapshots" ("user_id", "mode")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "smart_pick_snapshots" snapshot
      USING "smart_pick_snapshots" newer
      WHERE snapshot."user_id" = newer."user_id"
        AND (
          newer."generated_at" > snapshot."generated_at"
          OR (
            newer."generated_at" = snapshot."generated_at"
            AND newer."id" > snapshot."id"
          )
        )
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_smart_pick_snapshots_user_mode"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_smart_pick_snapshots_user"
        ON "smart_pick_snapshots" ("user_id")
    `);
  }
}
