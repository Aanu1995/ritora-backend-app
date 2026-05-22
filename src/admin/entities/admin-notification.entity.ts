import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';

export enum AdminNotificationType {
  AccountMonitoringAlert = 'account_monitoring_alert',
  OperationalIncidentAlert = 'operational_incident_alert',
}

export enum AdminNotificationSeverity {
  Info = 'info',
  Warning = 'warning',
  Critical = 'critical',
}

const encryptedNotificationBodyTransformer =
  encryptedNullableStringFieldTransformer('admin_notifications.body');

@Entity('admin_notifications')
@Index('idx_admin_notifications_admin_created', [
  'admin_id',
  'created_at',
  'id',
])
@Index('idx_admin_notifications_admin_read', ['admin_id', 'read_at'])
export class AdminNotification {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  admin_id: string;

  @Column({ type: 'varchar', length: 80 })
  type: AdminNotificationType;

  @Column({ type: 'varchar', length: 20 })
  severity: AdminNotificationSeverity;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({
    type: 'text',
    transformer: encryptedNotificationBodyTransformer,
  })
  body: string;

  @Column({ type: 'varchar', length: 240, nullable: true })
  action_url: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, string | number | boolean | null>;

  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
