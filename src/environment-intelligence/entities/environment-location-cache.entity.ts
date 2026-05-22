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
import { EnvironmentProviderName } from '../environment-intelligence.constants';

export interface EnvironmentLocationSnapshot {
  city: string;
  countryCode: string;
  label: string;
}

export interface EnvironmentCoordinatesSnapshot {
  latitude: number;
  longitude: number;
}

export interface EnvironmentProviderLocationSnapshot {
  providerLocationId: string;
  confidence: number;
}

const encryptedLocationSnapshot =
  encryptedJsonFieldTransformer<EnvironmentLocationSnapshot | null>(
    'environment_location_cache.location_snapshot',
    null,
  );

const encryptedCoordinatesSnapshot =
  encryptedJsonFieldTransformer<EnvironmentCoordinatesSnapshot | null>(
    'environment_location_cache.coordinates',
    null,
  );

const encryptedProviderLocationSnapshot =
  encryptedJsonFieldTransformer<EnvironmentProviderLocationSnapshot | null>(
    'environment_location_cache.provider_metadata',
    null,
  );

@Entity('environment_location_cache')
@Index(
  'UQ_environment_location_cache_user_provider_key',
  ['user_id', 'provider', 'location_key'],
  { unique: true },
)
export class EnvironmentLocationCache {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 30 })
  provider: EnvironmentProviderName;

  @Column({ type: 'varchar', length: 64 })
  location_key: string;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedLocationSnapshot,
  })
  location_snapshot: EnvironmentLocationSnapshot | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedCoordinatesSnapshot,
  })
  coordinates: EnvironmentCoordinatesSnapshot | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedProviderLocationSnapshot,
  })
  provider_metadata: EnvironmentProviderLocationSnapshot | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  time_zone: string | null;

  @Column({ type: 'timestamptz' })
  refreshed_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
