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
  CommunityHelpfulnessVote,
} from '../community.types';

@Entity('community_helpfulness_votes')
@Index(
  'idx_community_helpfulness_unique',
  ['user_id', 'content_type', 'content_id'],
  { unique: true },
)
export class CommunityHelpfulnessVoteEntity {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  content_type: CommunityContentType;

  @Column({ type: 'varchar', length: 26 })
  content_id: string;

  @Column({ type: 'varchar', length: 20 })
  vote: CommunityHelpfulnessVote;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
