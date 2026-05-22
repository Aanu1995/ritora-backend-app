import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { User } from './user.entity';

export enum AccountMonitoringEventType {
  AccountDeletionCancelled = 'account_deletion_cancelled',
  AccountDeletionRequested = 'account_deletion_requested',
  AuthLoginFailed = 'auth_login_failed',
  OAuthLoginFailed = 'oauth_login_failed',
  PasswordResetRequested = 'password_reset_requested',
  SkinJournalPhotoUploadFailed = 'skin_journal_photo_upload_failed',
  SupportEscalationReceived = 'support_escalation_received',
}

export type AccountMonitoringEventMetadata = Record<
  string,
  string | number | boolean | null
>;

const encryptedMetadataTransformer =
  encryptedJsonFieldTransformer<AccountMonitoringEventMetadata>(
    'account_monitoring_events.metadata',
    {},
  );

@Entity('account_monitoring_events')
@Index('idx_account_monitoring_events_user_type_time', [
  'user_id',
  'event_type',
  'occurred_at',
])
@Index('idx_account_monitoring_events_type_time', ['event_type', 'occurred_at'])
@Index('idx_account_monitoring_events_email_type_time', [
  'email_hash',
  'event_type',
  'occurred_at',
])
@Index('idx_account_monitoring_events_ip_type_time', [
  'ip_address_hash',
  'event_type',
  'occurred_at',
])
export class AccountMonitoringEvent {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 60 })
  event_type: AccountMonitoringEventType;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurred_at: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  email_hash: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip_address_hash: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'{}'::jsonb",
    transformer: encryptedMetadataTransformer,
  })
  metadata: AccountMonitoringEventMetadata;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
