import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';

export type NotificationKind =
  | 'photo_reminder'
  | 'reaction_detected'
  | 'simplification_started'
  | 'doctor_referral'
  | 'insight_ready'
  | 'wrapped_ready'
  | 'analysis_failed'
  | 'export_ready'
  | 'suggestion_ready'
  | 'slot_start'
  | 'recording_reminder'
  | 'product_nearing_expiry'
  | 'product_expired';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

const encryptedPayloadTransformer = encryptedJsonFieldTransformer<Record<
  string,
  unknown
> | null>('in_app_notifications.payload', null);

@Entity('in_app_notifications')
@Index('IDX_in_app_notifications_user_read_created', [
  'user_id',
  'read_at',
  'created_at',
])
@Index('IDX_in_app_notifications_read_retention', ['kind', 'read_at'], {
  where: '"read_at" IS NOT NULL',
})
@Index('IDX_in_app_notifications_user_unread', ['user_id'], {
  where: '"read_at" IS NULL',
})
@Index(
  'UQ_in_app_notifications_user_kind_dedupe',
  ['user_id', 'kind', 'dedupe_key'],
  {
    unique: true,
    where: '"dedupe_key" IS NOT NULL',
  },
)
export class InAppNotification {
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

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedPayloadTransformer,
  })
  payload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity: NotificationSeverity;

  @Column({ type: 'varchar', length: 160, nullable: true })
  dedupe_key: string | null;

  @Column({ type: 'text', nullable: true })
  deep_link: string | null;

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
