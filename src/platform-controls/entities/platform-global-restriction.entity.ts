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
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { PlatformGlobalRestrictionCapability } from '../platform-global-restrictions';

export const platformGlobalRestrictionInternalNoteTransformer =
  encryptedNullableStringFieldTransformer(
    'platform_global_restrictions.internal_note',
  );

@Entity('platform_global_restrictions')
@Index('idx_platform_global_restrictions_capability_enabled', [
  'capability',
  'enabled_at',
])
@Index('idx_platform_global_restrictions_disabled_at', ['disabled_at'])
export class PlatformGlobalRestriction {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 80 })
  capability: PlatformGlobalRestrictionCapability;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({
    type: 'text',
    transformer: platformGlobalRestrictionInternalNoteTransformer,
  })
  internal_note: string;

  @Column({ type: 'varchar', length: 26 })
  enabled_by_admin_id: string;

  @Column({ type: 'timestamptz' })
  enabled_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  disabled_at: Date | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  disabled_by_admin_id: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  disable_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
