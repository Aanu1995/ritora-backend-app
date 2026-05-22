import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export const ADMIN_ACCOUNT_MONITORING_SETTINGS_ID = 'default';

export type AdminAccountMonitoringThresholds = {
  aiCost24hCriticalUsd: number;
  aiCost24hWarningUsd: number;
  aiGenerations24hCritical: number;
  aiGenerations24hWarning: number;
  authFailures24hWarning: number;
  deletionEvents30dWarning: number;
  mediaCleanupAttempts24hWarning: number;
  mediaCleanupFailures24hWarning: number;
  passwordResets24hWarning: number;
  productExtractions24hWarning: number;
  safetyReactionSignals7dWarning: number;
  unknownAuthFailures24hCritical: number;
  unknownAuthFailures24hWarning: number;
  uploadFailures24hWarning: number;
};

@Entity('admin_account_monitoring_settings')
export class AdminAccountMonitoringSettings {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'jsonb' })
  thresholds: AdminAccountMonitoringThresholds;

  @Column({ type: 'varchar', length: 26, nullable: true })
  updated_by_admin_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
