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
  CommunityContentType,
  CommunityModerationStatus,
} from '../community.types';

@Entity('community_moderation_decisions')
@Index('idx_community_moderation_content_created', [
  'content_type',
  'content_id',
  'created_at',
])
export class CommunityModerationDecision {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 20 })
  content_type: CommunityContentType;

  @Column({ type: 'varchar', length: 26 })
  content_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  actor_admin_id: string | null;

  @Column({ type: 'varchar', length: 30 })
  from_status: CommunityModerationStatus;

  @Column({ type: 'varchar', length: 30 })
  to_status: CommunityModerationStatus;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
