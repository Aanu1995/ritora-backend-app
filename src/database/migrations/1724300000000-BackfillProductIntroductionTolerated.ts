import { MigrationInterface, QueryRunner } from 'typeorm';

const INTRODUCTION_BACKFILL_BATCH_SIZE = 5000;

type BackfilledProductRow = {
  id: string;
};

export class BackfillProductIntroductionTolerated1724300000000 implements MigrationInterface {
  public readonly transaction = false;

  name = 'BackfillProductIntroductionTolerated1724300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "IDX_inventory_products_one_active_introduction_trial"
    `);

    let updatedCount = INTRODUCTION_BACKFILL_BATCH_SIZE;
    while (updatedCount === INTRODUCTION_BACKFILL_BATCH_SIZE) {
      const rows = (await queryRunner.query(`
        WITH legacy_rows AS (
          SELECT "id"
          FROM "inventory_products"
          WHERE "introduction_status" IS NULL
          ORDER BY "id"
          LIMIT ${INTRODUCTION_BACKFILL_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "inventory_products" AS inventory
        SET
          "introduction_status" = 'tolerated',
          "introduction_started_at" = COALESCE(inventory."introduction_started_at", inventory."updated_at", inventory."created_at", now()),
          "introduction_status_updated_at" = COALESCE(inventory."introduction_status_updated_at", inventory."updated_at", inventory."created_at", now())
        FROM legacy_rows
        WHERE inventory."id" = legacy_rows."id"
        RETURNING inventory."id"
      `)) as BackfilledProductRow[] | undefined;

      updatedCount = Array.isArray(rows) ? rows.length : 0;
    }
  }

  down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
