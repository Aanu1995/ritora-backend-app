import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';

export enum AdminAuditAction {
  AdminInvited = 'admin_invited',
  AdminInvitationResent = 'admin_invitation_resent',
  AdminDeleted = 'admin_deleted',
  AdminLoggedOut = 'admin_logged_out',
  AdminSessionRevoked = 'admin_session_revoked',
  AdminSessionsRevoked = 'admin_sessions_revoked',
  AdminMfaEnabled = 'admin_mfa_enabled',
  AdminMfaDisabled = 'admin_mfa_disabled',
  AdminMfaRecoveryCodesRotated = 'admin_mfa_recovery_codes_rotated',
  AdminMfaRecoveryCodeUsed = 'admin_mfa_recovery_code_used',
  OperationalIncidentCreated = 'operational_incident_created',
  OperationalIncidentResolved = 'operational_incident_resolved',
  UserNoteCreated = 'user_note_created',
  UserRestricted = 'user_restricted',
  UserUnrestricted = 'user_unrestricted',
}

@Entity('admin_audit_logs')
export class AdminAuditLog {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({
    type: 'enum',
    enum: AdminAuditAction,
    enumName: 'admin_audit_action',
  })
  action: AdminAuditAction;

  @Index('idx_admin_audit_logs_actor_admin_id')
  @Column({ type: 'varchar', length: 26 })
  actor_admin_id: string;

  @Column({ type: 'varchar', length: 26 })
  actor_session_id: string;

  @Index('idx_admin_audit_logs_target_admin_id')
  @Column({ type: 'varchar', length: 26, nullable: true })
  target_admin_id: string | null;

  @Index('idx_admin_audit_logs_target_user_id')
  @Column({ type: 'varchar', length: 26, nullable: true })
  target_user_id: string | null;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  user_agent: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Index('idx_admin_audit_logs_created_at')
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
