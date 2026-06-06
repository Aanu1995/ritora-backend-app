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
import {
  CommunityContentType,
  CommunityModerationStatus,
  CommunityOutcomeSignal,
  type CommunityOutcomeSignalContext,
  type CommunitySafeProfileFacets,
  type CommunitySafetyFlag,
} from '../community.types';

@Entity('community_outcome_signal_votes')
@Index(
  'idx_community_outcome_signal_unique',
  ['user_id', 'content_type', 'content_id'],
  { unique: true },
)
export class CommunityOutcomeSignalVote {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  content_type: CommunityContentType;

  @Column({ type: 'varchar', length: 26 })
  content_id: string;

  @Column({ type: 'varchar', length: 30 })
  signal: CommunityOutcomeSignal;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  context: CommunityOutcomeSignalContext;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  safe_facets: CommunitySafeProfileFacets;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 30, default: 'published' })
  note_moderation_status: CommunityModerationStatus;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  note_safety_flags: CommunitySafetyFlag[];

  @Column({ type: 'varchar', length: 500, nullable: true })
  note_moderation_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  withdrawn_at: Date | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  withdrawn_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
