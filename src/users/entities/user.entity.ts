import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { UserConsent } from './user-consent.entity';
import { UserDataAccessLog } from './user-data-access-log.entity';

const encryptedUserStringTransformer = (field: string) =>
  encryptedNullableStringFieldTransformer(`users.${field}`);

@Entity('users')
export class User {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Index('idx_users_canonical_email', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  canonical_email: string;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  password_hash: string | null;

  @Index('idx_users_google_subject', {
    unique: true,
    where: '"google_subject" IS NOT NULL',
  })
  @Column({ type: 'varchar', length: 255, nullable: true })
  google_subject: string | null;

  @Index('idx_users_apple_subject', {
    unique: true,
    where: '"apple_subject" IS NOT NULL',
  })
  @Column({ type: 'varchar', length: 255, nullable: true })
  apple_subject: string | null;

  @Column({ type: 'varchar', length: 100 })
  first_name: string;

  @Column({ type: 'varchar', length: 100 })
  last_name: string;

  @Column({ type: 'boolean', default: false })
  email_verified: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  email_verification_token_hash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  email_verification_expires: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  password_reset_token_hash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  password_reset_expires: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  account_deletion_requested_at: Date | null;

  @Index('idx_users_account_deletion_scheduled_for')
  @Column({ type: 'timestamptz', nullable: true })
  account_deletion_scheduled_for: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  account_deletion_cancel_token_hash: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  account_deletion_confirm_token_hash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  account_deletion_confirm_expires: Date | null;

  @Column({ type: 'varchar', length: 5, default: 'en' })
  preferred_language: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  time_zone: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedUserStringTransformer('date_of_birth'),
  })
  date_of_birth: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedUserStringTransformer('sex_at_birth'),
  })
  sex_at_birth: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => UserConsent, (consent) => consent.user)
  consents: UserConsent[];

  @OneToMany(() => UserDataAccessLog, (log) => log.user)
  data_access_logs: UserDataAccessLog[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
