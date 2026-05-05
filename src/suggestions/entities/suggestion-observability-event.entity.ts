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
import { User } from '../../users/entities/user.entity';
import {
  SuggestionObservabilityEventKind,
  SuggestionObservabilitySeverity,
} from '../suggestions.constants';

export type SuggestionObservabilityMetadata = Record<
  string,
  string | number | boolean | null
>;

const encryptedObservabilityMetadataTransformer =
  encryptedJsonFieldTransformer<SuggestionObservabilityMetadata>(
    'suggestion_observability_events.metadata',
    {},
  );

@Entity('suggestion_observability_events')
@Index('IDX_suggestion_observability_kind_created', ['kind', 'created_at'])
@Index('IDX_suggestion_observability_user_created', ['user_id', 'created_at'])
@Index('IDX_suggestion_observability_severity_created', [
  'severity',
  'created_at',
])
export class SuggestionObservabilityEvent {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  suggestion_instance_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  job_id: string | null;

  @Column({ type: 'varchar', length: 40 })
  kind: SuggestionObservabilityEventKind;

  @Column({ type: 'varchar', length: 20 })
  severity: SuggestionObservabilitySeverity;

  @Column({
    type: 'jsonb',
    transformer: encryptedObservabilityMetadataTransformer,
  })
  metadata: SuggestionObservabilityMetadata;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
