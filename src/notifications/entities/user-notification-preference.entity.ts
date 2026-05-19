import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { SKIN_JOURNAL_REMINDER_DEFAULT_TIME } from '../../skin-journal/skin-journal.constants';
import { User } from '../../users/entities/user.entity';
import {
  INSIGHT_CADENCE_DEFAULT,
  INSIGHT_DIGEST_DAY_DEFAULT,
  INSIGHT_DIGEST_LOCAL_TIME_DEFAULT,
  PRODUCT_EXPIRY_NOTICE_DAYS_DEFAULT,
  type InsightCadence,
} from '../notifications.constants';

export const NotificationChannelValue = {
  Email: 'email',
  InApp: 'in_app',
  Push: 'push',
} as const;

export type NotificationChannel =
  (typeof NotificationChannelValue)[keyof typeof NotificationChannelValue];

export const NOTIFICATION_CHANNEL_VALUES = Object.values(
  NotificationChannelValue,
);

export const DEFAULT_NOTIFICATION_CHANNELS: NotificationChannel[] = [
  NotificationChannelValue.InApp,
];

@Entity('user_notification_preferences')
export class UserNotificationPreference {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26, unique: true })
  user_id: string;

  @Column({ type: 'time', default: SKIN_JOURNAL_REMINDER_DEFAULT_TIME })
  photo_reminder_local_time: string;

  @Column({ type: 'boolean', default: true })
  photo_reminder_enabled: boolean;

  @Column({ type: 'jsonb', default: () => '\'["in_app"]\'::jsonb' })
  channels: NotificationChannel[];

  @Column({ type: 'jsonb', nullable: true })
  reaction_alert_channels: NotificationChannel[] | null;

  @Column({ type: 'boolean', default: true })
  reaction_alerts_enabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  simplification_alert_channels: NotificationChannel[] | null;

  @Column({ type: 'boolean', default: true })
  simplification_alerts_enabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  insight_alert_channels: NotificationChannel[] | null;

  @Column({ type: 'boolean', default: true })
  insight_alerts_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  ai_polished_insights_enabled: boolean;

  @Column({ type: 'varchar', length: 16, default: INSIGHT_CADENCE_DEFAULT })
  insight_cadence: InsightCadence;

  @Column({ type: 'integer', default: INSIGHT_DIGEST_DAY_DEFAULT })
  insight_digest_day: number;

  @Column({ type: 'time', default: INSIGHT_DIGEST_LOCAL_TIME_DEFAULT })
  insight_digest_local_time: string;

  @Column({ type: 'jsonb', nullable: true })
  wrapped_alert_channels: NotificationChannel[] | null;

  @Column({ type: 'boolean', default: true })
  wrapped_alerts_enabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  suggestion_ready_channels: NotificationChannel[] | null;

  @Column({ type: 'boolean', default: true })
  suggestion_ready_enabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  smart_pick_ready_channels: NotificationChannel[] | null;

  @Column({ type: 'boolean', default: false })
  smart_pick_ready_enabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  slot_start_channels: NotificationChannel[] | null;

  @Column({ type: 'boolean', default: true })
  slot_start_enabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  recording_reminder_channels: NotificationChannel[] | null;

  @Column({ type: 'boolean', default: true })
  recording_reminder_enabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  product_expiry_alert_channels: NotificationChannel[] | null;

  @Column({ type: 'boolean', default: true })
  product_expiry_alerts_enabled: boolean;

  @Column({ type: 'integer', default: PRODUCT_EXPIRY_NOTICE_DAYS_DEFAULT })
  product_expiry_notice_days: number;

  @Column({ type: 'integer', default: 120 })
  suggestion_lead_time_minutes: number;

  @Column({ type: 'boolean', default: false })
  quiet_hours_enabled: boolean;

  @Column({ type: 'time', default: '22:30' })
  quiet_hours_start: string;

  @Column({ type: 'time', default: '06:30' })
  quiet_hours_end: string;

  @Column({ type: 'boolean', default: false })
  photo_tutorial_completed: boolean;

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
