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
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import {
  NotificationKind,
  NotificationSeverity,
} from './in-app-notification.entity';

export type ScheduledNotificationStatus =
  | 'pending'
  | 'dispatching'
  | 'sent'
  | 'cancelled'
  | 'failed';

const encryptedScheduledPayloadTransformer =
  encryptedJsonFieldTransformer<Record<string, unknown> | null>(
    'scheduled_notifications.payload',
    null,
  );

@Entity('scheduled_notifications')
@Index('IDX_scheduled_notifications_due', ['status', 'deliver_at'])
@Index(
  'UQ_scheduled_notifications_user_kind_dedupe',
  ['user_id', 'kind', 'dedupe_key'],
  {
    unique: true,
    where: '"dedupe_key" IS NOT NULL',
  },
)
export class ScheduledNotification {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 40 })
  kind: NotificationKind;

  @Column({ type: 'text' })
  title_key: string;

  @Column({ type: 'text' })
  body_key: string;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity: NotificationSeverity;

  @Column({ type: 'varchar', length: 160, nullable: true })
  dedupe_key: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedScheduledPayloadTransformer,
  })
  payload: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  deep_link: string | null;

  @Column({ type: 'timestamptz' })
  deliver_at: Date;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ScheduledNotificationStatus;

  @Column({ type: 'integer', default: 0 })
  attempt_count: number;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  locked_at: Date | null;

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
