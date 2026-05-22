import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import {
  encryptedJsonFieldTransformer,
  encryptedNullableStringFieldTransformer,
} from '../../skin-profile/skin-profile-field-encryption';
import type {
  RestoreStrategy,
  ScheduleSnapshot,
  SimplificationMode,
} from '../skin-journal.constants';
import { SkinJournalEvent } from './skin-journal-event.entity';

const encryptedScheduleSnapshotTransformer =
  encryptedJsonFieldTransformer<ScheduleSnapshot | null>(
    'routine_simplification_events.original_schedule_snapshot',
    null,
  );

@Entity('routine_simplification_events')
@Index('IDX_simplification_user_unack_active', ['user_id'], {
  where: '"ended_at" IS NULL AND "acknowledged_at" IS NULL',
})
export class RoutineSimplificationEvent {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  triggered_by_event_id: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'started_at' })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  ended_at: Date | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedScheduleSnapshotTransformer,
  })
  original_schedule_snapshot: ScheduleSnapshot | null;

  @Column({ type: 'varchar', length: 40, default: 'barrier_repair' })
  simplification_mode: SimplificationMode;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedNullableStringFieldTransformer(
      'routine_simplification_events.reason',
    ),
  })
  reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'full' })
  restore_strategy: RestoreStrategy;

  @ManyToOne(() => SkinJournalEvent, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'triggered_by_event_id' })
  triggered_by_event: SkinJournalEvent | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
