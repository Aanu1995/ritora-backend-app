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
  CommunityReportReason,
  CommunityReportStatus,
} from '../community.types';

@Entity('community_reports')
@Index('idx_community_reports_status_created', ['status', 'created_at'])
@Index('idx_community_reports_content', ['content_type', 'content_id'])
export class CommunityReport {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  reporter_user_id: string;

  @Column({ type: 'varchar', length: 20 })
  content_type: CommunityContentType;

  @Column({ type: 'varchar', length: 26 })
  content_id: string;

  @Column({ type: 'varchar', length: 40 })
  reason: CommunityReportReason;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 20, default: CommunityReportStatus.Open })
  status: CommunityReportStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
