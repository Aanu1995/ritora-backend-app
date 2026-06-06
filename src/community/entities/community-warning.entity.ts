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
import { CommunitySafetySeverity } from '../community.types';

@Entity('community_warnings')
@Index('idx_community_warnings_active_severity', [
  'active',
  'severity',
  'updated_at',
])
export class CommunityWarning {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'varchar', length: 1000 })
  body: string;

  @Column({ type: 'varchar', length: 20 })
  severity: CommunitySafetySeverity;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  affected_facets: string[];

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
