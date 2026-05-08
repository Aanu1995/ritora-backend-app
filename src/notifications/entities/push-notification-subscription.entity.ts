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
import {
  encryptedJsonFieldTransformer,
  encryptedNullableStringFieldTransformer,
} from '../../skin-profile/skin-profile-field-encryption';
import { User } from '../../users/entities/user.entity';

export const PushProviderValue = {
  WebPush: 'web_push',
  Fcm: 'fcm',
  Apns: 'apns',
} as const;

export type PushProvider =
  (typeof PushProviderValue)[keyof typeof PushProviderValue];

export const PushPlatformValue = {
  Web: 'web',
  Ios: 'ios',
  Android: 'android',
} as const;

export type PushPlatform =
  (typeof PushPlatformValue)[keyof typeof PushPlatformValue];

export type WebPushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

const encryptedWebPushKeysTransformer =
  encryptedJsonFieldTransformer<WebPushSubscriptionKeys | null>(
    'push_notification_subscriptions.web_push_keys',
    null,
  );

const encryptedMobileTokenTransformer = encryptedJsonFieldTransformer<
  string | null
>('push_notification_subscriptions.mobile_token', null);
const encryptedEndpointTransformer = encryptedNullableStringFieldTransformer(
  'push_notification_subscriptions.endpoint',
);
const encryptedUserAgentTransformer = encryptedNullableStringFieldTransformer(
  'push_notification_subscriptions.user_agent',
);

@Entity('push_notification_subscriptions')
@Index('IDX_push_subscriptions_user_active', ['user_id', 'revoked_at'])
@Index(
  'UQ_push_subscriptions_provider_endpoint_hash',
  ['provider', 'endpoint_hash'],
  {
    unique: true,
    where: '"endpoint_hash" IS NOT NULL',
  },
)
@Index(
  'UQ_push_subscriptions_provider_token_hash',
  ['provider', 'token_hash'],
  {
    unique: true,
    where: '"token_hash" IS NOT NULL',
  },
)
export class PushNotificationSubscription {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  provider: PushProvider;

  @Column({ type: 'varchar', length: 20 })
  platform: PushPlatform;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedEndpointTransformer,
  })
  endpoint: string | null;

  @Column({ type: 'char', length: 64, nullable: true })
  endpoint_hash: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedWebPushKeysTransformer,
  })
  web_push_keys: WebPushSubscriptionKeys | null;

  @Column({
    name: 'mobile_token',
    type: 'jsonb',
    nullable: true,
    transformer: encryptedMobileTokenTransformer,
  })
  token: string | null;

  @Column({ type: 'char', length: 64, nullable: true })
  token_hash: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  device_name: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedUserAgentTransformer,
  })
  user_agent: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_seen_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'integer', default: 0 })
  failure_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_failure_at: Date | null;

  @Column({ type: 'text', nullable: true })
  last_failure_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
