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
import { User } from '../../users/entities/user.entity';
import { SuggestionInstance } from './suggestion-instance.entity';

@Entity('suggestion_recording_reminder_snoozes')
@Index(
  'UQ_suggestion_recording_snoozes_user_suggestion',
  ['user_id', 'suggestion_instance_id'],
  { unique: true },
)
@Index('IDX_suggestion_recording_snoozes_until', ['snoozed_until'])
export class SuggestionRecordingReminderSnooze {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  suggestion_instance_id: string;

  @Column({ type: 'timestamptz' })
  snoozed_until: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => SuggestionInstance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'suggestion_instance_id' })
  suggestion_instance: SuggestionInstance;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
