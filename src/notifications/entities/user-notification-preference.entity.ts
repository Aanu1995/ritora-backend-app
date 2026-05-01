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

export type NotificationChannel = 'email' | 'in_app';

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

  @Column({ type: 'jsonb', default: () => '\'["in_app","email"]\'::jsonb' })
  channels: NotificationChannel[];

  @Column({ type: 'boolean', default: true })
  reaction_alerts_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  simplification_alerts_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  insight_alerts_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  ai_polished_insights_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  wrapped_alerts_enabled: boolean;

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
