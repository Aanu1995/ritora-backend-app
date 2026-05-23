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
  CommunityDisclosureType,
  CommunityModerationStatus,
  type CommunitySafeProfileFacets,
  type CommunitySafetyFlag,
} from '../community.types';

@Entity('community_routines')
@Index('idx_community_routines_status_updated', [
  'moderation_status',
  'updated_at',
])
@Index('idx_community_routines_author_created', [
  'author_user_id',
  'created_at',
])
export class CommunityRoutine {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  author_user_id: string;

  @Column({ type: 'varchar', length: 26 })
  community_profile_id: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  summary: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  concern_tags: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  goal_tags: string[];

  @Column({ type: 'varchar', length: 30 })
  disclosure_type: CommunityDisclosureType;

  @Column({ type: 'varchar', length: 30 })
  moderation_status: CommunityModerationStatus;

  @Column({ type: 'varchar', length: 26, nullable: true })
  assigned_admin_id: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  safe_facets: CommunitySafeProfileFacets;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  safety_flags: CommunitySafetyFlag[];

  @Column({ type: 'integer', default: 0 })
  helpful_count: number;

  @Column({ type: 'integer', default: 0 })
  not_helpful_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
