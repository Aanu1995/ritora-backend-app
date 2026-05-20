import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminInvitationResentAuditAction1718900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'admin_audit_action'
        ) THEN
          CREATE TYPE "admin_audit_action" AS ENUM (
            'admin_invited',
            'admin_deleted',
            'user_restricted',
            'user_unrestricted'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TYPE "admin_audit_action"
      ADD VALUE IF NOT EXISTS 'admin_invitation_resent'
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL enum values cannot be safely removed without recreating the type.
  }
}
