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
import { User } from '../../users/entities/user.entity';
import { ApplicationLogSnapshot } from '../application-tracking.constants';
import { ApplicationLog } from './application-log.entity';

const encryptedSnapshotTransformer =
  encryptedJsonFieldTransformer<ApplicationLogSnapshot | null>(
    'application_log_versions.snapshot',
    null,
  );
const encryptedVersionEditReasonTransformer =
  encryptedNullableStringFieldTransformer(
    'application_log_versions.edit_reason',
  );

@Entity('application_log_versions')
@Index(
  'UQ_application_versions_log_version',
  ['application_log_id', 'version'],
  { unique: true },
)
@Index('IDX_application_versions_log_created', [
  'application_log_id',
  'created_at',
])
export class ApplicationLogVersion {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  application_log_id: string;

  @Column({ type: 'integer' })
  version: number;

  @Column({ type: 'jsonb', transformer: encryptedSnapshotTransformer })
  snapshot: ApplicationLogSnapshot;

  @Column({ type: 'varchar', length: 26 })
  edited_by_user_id: string;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedVersionEditReasonTransformer,
  })
  edit_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => ApplicationLog, (log) => log.versions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'application_log_id' })
  application_log: ApplicationLog;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'edited_by_user_id' })
  edited_by_user: User;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
