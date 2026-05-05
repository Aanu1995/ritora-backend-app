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
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { User } from '../../users/entities/user.entity';
import { DayOfWeek, SlotMode } from '../dto/schedule.constants';
import { RoutineStep } from './routine-step.entity';

const encryptedSpecialistProviderTransformer =
  encryptedNullableStringFieldTransformer(
    'schedule_slots.specialist_provider_name',
  );
const encryptedSpecialistClinicTransformer =
  encryptedNullableStringFieldTransformer(
    'schedule_slots.specialist_clinic_name',
  );
const encryptedSpecialistSafetyNotesTransformer =
  encryptedNullableStringFieldTransformer(
    'schedule_slots.specialist_safety_notes',
  );

@Entity('schedule_slots')
@Index(
  'UQ_schedule_slots_user_day_time',
  ['user_id', 'day_of_week', 'slot_time'],
  {
    unique: true,
  },
)
@Index('IDX_schedule_slots_user_day', ['user_id', 'day_of_week'])
export class ScheduleSlot {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 10 })
  day_of_week: DayOfWeek;

  @Column({ type: 'time' })
  slot_time: string;

  @Column({ type: 'varchar', length: 10, default: 'ai' })
  mode: SlotMode;

  @Column({ type: 'text', nullable: true })
  slot_notes: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSpecialistProviderTransformer,
  })
  specialist_provider_name: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSpecialistClinicTransformer,
  })
  specialist_clinic_name: string | null;

  @Column({ type: 'date', nullable: true })
  specialist_active_since: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSpecialistSafetyNotesTransformer,
  })
  specialist_safety_notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => RoutineStep, (step) => step.slot)
  steps: RoutineStep[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
