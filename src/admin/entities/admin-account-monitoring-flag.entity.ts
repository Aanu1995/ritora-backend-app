import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';

export enum AdminAccountMonitoringSignalType {
  DeletionComplianceWatch = 'deletion_compliance_watch',
  HighAiCost = 'high_ai_cost',
  ManualWatch = 'manual_watch',
  ProductExtractionAbuse = 'product_extraction_abuse',
  RepeatedAuthFailures = 'repeated_auth_failures',
  RepeatedUploadFailures = 'repeated_upload_failures',
  SafetyCriticalReactionSignals = 'safety_critical_reaction_signals',
  SupportEscalation = 'support_escalation',
}

export enum AdminAccountMonitoringStatus {
  Open = 'open',
  Watching = 'watching',
  Resolved = 'resolved',
}

export enum AdminAccountMonitoringSeverity {
  Info = 'info',
  Warning = 'warning',
  Critical = 'critical',
}

export const encryptedAccountMonitoringLatestSignalTransformer =
  encryptedNullableStringFieldTransformer(
    'admin_account_monitoring_flags.latest_signal',
  );

export const encryptedAccountMonitoringInternalNoteTransformer =
  encryptedNullableStringFieldTransformer(
    'admin_account_monitoring_flags.internal_note',
  );

export const encryptedAccountMonitoringResolutionNoteTransformer =
  encryptedNullableStringFieldTransformer(
    'admin_account_monitoring_flags.resolution_note',
  );

@Entity('admin_account_monitoring_flags')
@Index('idx_admin_account_monitoring_status_review', [
  'status',
  'next_review_at',
  'created_at',
  'id',
])
@Index('idx_admin_account_monitoring_user_status', [
  'user_id',
  'status',
  'created_at',
  'id',
])
@Index('idx_admin_account_monitoring_assigned_status', [
  'assigned_admin_id',
  'status',
  'next_review_at',
])
@Index('idx_admin_account_monitoring_signal_status', [
  'signal_type',
  'status',
  'created_at',
  'id',
])
export class AdminAccountMonitoringFlag {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({
    type: 'enum',
    enum: AdminAccountMonitoringSignalType,
    enumName: 'admin_account_monitoring_signal_type',
  })
  signal_type: AdminAccountMonitoringSignalType;

  @Column({
    type: 'enum',
    enum: AdminAccountMonitoringStatus,
    enumName: 'admin_account_monitoring_status',
    default: AdminAccountMonitoringStatus.Open,
  })
  status: AdminAccountMonitoringStatus;

  @Column({
    type: 'enum',
    enum: AdminAccountMonitoringSeverity,
    enumName: 'admin_account_monitoring_severity',
  })
  severity: AdminAccountMonitoringSeverity;

  @Column({ type: 'varchar', length: 160 })
  summary: string;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedAccountMonitoringLatestSignalTransformer,
  })
  latest_signal: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedAccountMonitoringInternalNoteTransformer,
  })
  internal_note: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  assigned_admin_id: string | null;

  @Column({ type: 'varchar', length: 26 })
  created_by_admin_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  resolved_by_admin_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  next_review_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedAccountMonitoringResolutionNoteTransformer,
  })
  resolution_note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
