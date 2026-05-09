import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedJsonFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { User } from '../../users/entities/user.entity';
import { EnvironmentContextSummary } from '../environment-intelligence.types';
import { EnvironmentLocationCache } from './environment-location-cache.entity';

const encryptedEnvironmentSummary =
  encryptedJsonFieldTransformer<EnvironmentContextSummary | null>(
    'environment_snapshots.summary',
    null,
  );

@Entity('environment_snapshots')
@Index('IDX_environment_snapshots_user_target', [
  'user_id',
  'target_date',
  'target_time_bucket',
])
@Index('IDX_environment_snapshots_expires_at', ['expires_at'])
export class EnvironmentSnapshot {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  location_cache_id: string | null;

  @Column({ type: 'date' })
  target_date: string;

  @Column({ type: 'varchar', length: 5 })
  target_time_bucket: string;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedEnvironmentSummary,
  })
  summary: EnvironmentContextSummary | null;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => EnvironmentLocationCache, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'location_cache_id' })
  location_cache: EnvironmentLocationCache | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
