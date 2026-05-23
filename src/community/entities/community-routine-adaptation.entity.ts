import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import type { CommunityAdaptationChange } from '../community.types';

@Entity('community_routine_adaptations')
@Index('idx_community_adaptations_user_created', ['user_id', 'created_at'])
export class CommunityRoutineAdaptation {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  routine_id: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  changes: CommunityAdaptationChange[];

  @Column({ type: 'boolean', default: false })
  saved: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
