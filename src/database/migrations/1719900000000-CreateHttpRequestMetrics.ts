import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHttpRequestMetrics1719900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "http_request_metrics" (
        "id" varchar(26) PRIMARY KEY,
        "method" varchar(10) NOT NULL,
        "route" varchar(180) NOT NULL,
        "status_code" integer NOT NULL,
        "duration_ms" integer NOT NULL,
        "occurred_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_http_request_metrics_occurred_route"
      ON "http_request_metrics" ("occurred_at", "route", "method")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_http_request_metrics_route_method_occurred"
      ON "http_request_metrics" ("route", "method", "occurred_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_http_request_metrics_status_occurred"
      ON "http_request_metrics" ("status_code", "occurred_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_http_request_metrics_status_occurred"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_http_request_metrics_route_method_occurred"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_http_request_metrics_occurred_route"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "http_request_metrics"`);
  }
}
