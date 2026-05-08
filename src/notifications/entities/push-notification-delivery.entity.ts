import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import {
  NotificationKind,
  NotificationSeverity,
} from './in-app-notification.entity';
import { PushNotificationSubscription } from './push-notification-subscription.entity';

export const PushDeliveryStatusValue = {
  Sending: 'sending',
  Sent: 'sent',
  Failed: 'failed',
  Skipped: 'skipped',
} as const;

export type PushDeliveryStatus =
  (typeof PushDeliveryStatusValue)[keyof typeof PushDeliveryStatusValue];

const encryptedPushPayloadTransformer = encryptedJsonFieldTransformer<Record<
  string,
  unknown
> | null>('push_notification_deliveries.push_payload', null);

@Entity('push_notification_deliveries')
@Index('IDX_push_deliveries_user_attempted', ['user_id', 'attempted_at'])
@Index('IDX_push_deliveries_subscription_attempted', [
  'subscription_id',
  'attempted_at',
])
@Index('IDX_push_deliveries_retry_due', ['status', 'next_attempt_at'])
@Index(
  'UQ_push_deliveries_subscription_kind_dedupe',
  ['subscription_id', 'kind', 'dedupe_key'],
  {
    unique: true,
    where: '"dedupe_key" IS NOT NULL',
  },
)
export class PushNotificationDelivery {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  subscription_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  notification_id: string | null;

  @Column({ type: 'varchar', length: 40 })
  kind: NotificationKind;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity: NotificationSeverity;

  @Column({ type: 'varchar', length: 160, nullable: true })
  dedupe_key: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: PushDeliveryStatus;

  @Column({ type: 'integer', nullable: true })
  provider_status_code: number | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedPushPayloadTransformer,
  })
  push_payload: Record<string, unknown> | null;

  @Column({ type: 'integer', default: 0 })
  attempt_count: number;

  @Column({ type: 'integer', default: 3 })
  max_attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_attempt_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  next_attempt_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  locked_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  attempted_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => PushNotificationSubscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: PushNotificationSubscription;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
