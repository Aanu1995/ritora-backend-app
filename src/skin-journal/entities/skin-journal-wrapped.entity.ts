import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import {
  encryptedJsonFieldTransformer,
  encryptedNullableStringFieldTransformer,
} from '../../skin-profile/skin-profile-field-encryption';
import {
  WrappedStatusValue,
  type WrappedManifest,
  type WrappedPeriodKind,
  type WrappedStatus,
} from '../skin-journal.constants';

const encryptedManifestTransformer =
  encryptedJsonFieldTransformer<WrappedManifest | null>(
    'skin_journal_wrapped.manifest',
    null,
  );

@Entity('skin_journal_wrapped')
@Index('IDX_skin_journal_wrapped_user_period', [
  'user_id',
  'period_kind',
  'period_start',
])
export class SkinJournalWrapped {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  period_kind: WrappedPeriodKind;

  @Column({ type: 'date' })
  period_start: string;

  @Column({ type: 'date' })
  period_end: string;

  @Column({ type: 'varchar', length: 30, default: WrappedStatusValue.Pending })
  status: WrappedStatus;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedManifestTransformer,
  })
  manifest: WrappedManifest | null;

  @Column({ type: 'text', nullable: true })
  media_object_key: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedNullableStringFieldTransformer(
      'skin_journal_wrapped.error',
    ),
  })
  error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  generated_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
