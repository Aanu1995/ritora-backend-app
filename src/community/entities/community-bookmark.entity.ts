import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { CommunityContentType } from '../community.types';

@Entity('community_bookmarks')
@Index(
  'idx_community_bookmarks_unique',
  ['user_id', 'content_type', 'content_id'],
  { unique: true },
)
@Index('idx_community_bookmarks_user_created', [
  'user_id',
  'created_at',
  'id',
])
export class CommunityBookmark {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  content_type: CommunityContentType;

  @Column({ type: 'varchar', length: 26 })
  content_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
