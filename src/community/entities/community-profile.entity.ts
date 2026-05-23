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
import type { CommunitySafeProfileFacets } from '../community.types';

@Entity('community_profiles')
@Index('idx_community_profiles_user', ['user_id'], { unique: true })
export class CommunityProfile {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 80 })
  display_name: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  safe_facets: CommunitySafeProfileFacets;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
