import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminAuditMonitoringFlagIndex1721400000000 implements MigrationInterface {
  name = 'AddAdminAuditMonitoringFlagIndex1721400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_monitoring_flag_id"
      ON "admin_audit_logs" ((metadata ->> 'monitoringFlagId'))
      WHERE metadata ? 'monitoringFlagId'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_admin_audit_logs_monitoring_flag_id"
    `);
  }
}
