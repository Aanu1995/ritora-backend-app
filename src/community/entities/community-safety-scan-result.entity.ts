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
  type CommunitySafetyScanSnapshot,
} from '../community.types';

@Entity('community_safety_scan_results')
@Index('idx_community_safety_scan_content_created', [
  'content_type',
  'content_id',
  'created_at',
])
export class CommunitySafetyScanResult {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 20 })
  content_type: CommunityContentType;

  @Column({ type: 'varchar', length: 26 })
  content_id: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  result: CommunitySafetyScanSnapshot;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
