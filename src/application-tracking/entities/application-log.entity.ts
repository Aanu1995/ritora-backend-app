import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { SuggestionInstance } from '../../suggestions/entities/suggestion-instance.entity';
import { User } from '../../users/entities/user.entity';
import { ApplicationDaypart } from '../application-tracking.constants';
import { ApplicationLogItem } from './application-log-item.entity';
import { ApplicationLogVersion } from './application-log-version.entity';

const encryptedGeneralNotesTransformer =
  encryptedNullableStringFieldTransformer('application_logs.general_notes');
const encryptedEditReasonTransformer = encryptedNullableStringFieldTransformer(
  'application_logs.edit_reason',
);

@Entity('application_logs')
@Index('IDX_application_logs_user_target_date', ['user_id', 'target_date'])
@Index(
  'UQ_application_logs_user_suggestion',
  ['user_id', 'suggestion_instance_id'],
  {
    unique: true,
    where: '"suggestion_instance_id" IS NOT NULL',
  },
)
export class ApplicationLog {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  suggestion_instance_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  slot_id: string | null;

  @Column({ type: 'date' })
  target_date: string;

  @Column({ type: 'time', nullable: true })
  target_time: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  daypart: ApplicationDaypart | null;

  @Column({ type: 'timestamptz', nullable: true })
  applied_at: Date | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedGeneralNotesTransformer,
  })
  general_notes: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedEditReasonTransformer,
  })
  edit_reason: string | null;

  @Column({ type: 'integer', default: 0 })
  edit_count: number;

  @Column({ type: 'boolean', default: false })
  has_been_edited: boolean;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  first_recorded_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_edited_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => SuggestionInstance, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'suggestion_instance_id' })
  suggestion_instance: SuggestionInstance | null;

  @ManyToOne(() => ScheduleSlot, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'slot_id' })
  slot: ScheduleSlot | null;

  @OneToMany(() => ApplicationLogItem, (item) => item.application_log)
  items: ApplicationLogItem[];

  @OneToMany(() => ApplicationLogVersion, (version) => version.application_log)
  versions: ApplicationLogVersion[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
