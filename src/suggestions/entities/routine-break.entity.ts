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
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { User } from '../../users/entities/user.entity';
import { RoutineBreakStatus } from '../suggestions.constants';

const encryptedRoutineBreakReasonTransformer =
  encryptedNullableStringFieldTransformer('routine_breaks.reason');

@Entity('routine_breaks')
@Index('IDX_routine_breaks_user_status_starts', [
  'user_id',
  'status',
  'starts_at',
])
@Index('IDX_routine_breaks_user_ends', ['user_id', 'ends_at'])
export class RoutineBreak {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'timestamptz' })
  starts_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  ends_at: Date | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedRoutineBreakReasonTransformer,
  })
  reason: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: RoutineBreakStatus;

  @Column({ type: 'timestamptz', nullable: true })
  resumed_at: Date | null;

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
