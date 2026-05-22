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
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import type { EventKind, EventSeverity } from '../skin-journal.constants';
import { SkinJournalEntry } from './skin-journal-entry.entity';

const encryptedPayloadTransformer = encryptedJsonFieldTransformer<Record<
  string,
  unknown
> | null>('skin_journal_events.payload', null);

@Entity('skin_journal_events')
@Index('IDX_skin_journal_events_user_kind_ack', [
  'user_id',
  'kind',
  'acknowledged_at',
])
@Index('IDX_skin_journal_events_user_ack_severity', [
  'user_id',
  'acknowledged_at',
  'severity',
])
@Index('IDX_skin_journal_events_user_unack_warning', ['user_id'], {
  where: `"acknowledged_at" IS NULL AND "severity" IN ('warning','critical')`,
})
export class SkinJournalEvent {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  entry_id: string;

  @Column({ type: 'varchar', length: 40 })
  kind: EventKind;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity: EventSeverity;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedPayloadTransformer,
  })
  payload: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => SkinJournalEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id' })
  entry: SkinJournalEntry;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
