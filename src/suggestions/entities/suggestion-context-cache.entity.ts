import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { SuggestionContextSummary } from '../suggestion-context.types';

const encryptedSuggestionContextSummaryTransformer =
  encryptedJsonFieldTransformer<SuggestionContextSummary | null>(
    'suggestion_context_cache.summary',
    null,
  );

@Entity('suggestion_context_cache')
@Index(
  'UQ_suggestion_context_cache_user_date_time',
  ['user_id', 'context_date', 'target_time'],
  { unique: true },
)
export class SuggestionContextCache {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'date' })
  context_date: string;

  @Column({ type: 'time' })
  target_time: string;

  @Column({ type: 'varchar', length: 80 })
  cache_key: string;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedSuggestionContextSummaryTransformer,
  })
  summary: SuggestionContextSummary | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
