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
  ExportStatusValue,
  type ExportStatus,
  type SkinJournalExportPayload,
} from '../skin-journal.constants';

const encryptedPayloadTransformer =
  encryptedJsonFieldTransformer<SkinJournalExportPayload | null>(
    'skin_journal_export_jobs.payload',
    null,
  );

@Entity('skin_journal_export_jobs')
@Index('IDX_skin_journal_export_jobs_user_created', ['user_id', 'created_at'])
export class SkinJournalExportJob {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'date' })
  range_from: string;

  @Column({ type: 'date' })
  range_to: string;

  @Column({ type: 'varchar', length: 20, default: ExportStatusValue.Ready })
  status: ExportStatus;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedPayloadTransformer,
  })
  payload: SkinJournalExportPayload | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedNullableStringFieldTransformer(
      'skin_journal_export_jobs.error',
    ),
  })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
