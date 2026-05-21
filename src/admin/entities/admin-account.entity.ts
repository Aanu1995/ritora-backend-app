import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';
import { AdminSession } from './admin-session.entity';

const encryptedAdminTotpSecretTransformer =
  encryptedNullableStringFieldTransformer('admin_accounts.mfa_totp_secret');
const encryptedAdminPendingTotpSecretTransformer =
  encryptedNullableStringFieldTransformer(
    'admin_accounts.mfa_pending_totp_secret',
  );

export enum AdminAccountRole {
  Root = 'root',
  Admin = 'admin',
}

export enum AdminAccountStatus {
  Invited = 'invited',
  Active = 'active',
  Disabled = 'disabled',
}

@Entity('admin_accounts')
export class AdminAccount {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Index('idx_admin_accounts_canonical_email_active', {
    unique: true,
    where: '"deleted_at" IS NULL',
  })
  @Column({ type: 'varchar', length: 255 })
  canonical_email: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({
    type: 'enum',
    enum: AdminAccountRole,
    enumName: 'admin_account_role',
    default: AdminAccountRole.Admin,
  })
  role: AdminAccountRole;

  @Column({
    type: 'enum',
    enum: AdminAccountStatus,
    enumName: 'admin_account_status',
    default: AdminAccountStatus.Invited,
  })
  status: AdminAccountStatus;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  password_hash: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  invitation_token_hash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  invitation_expires_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  password_reset_token_hash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  password_reset_expires: Date | null;

  @Column({
    type: 'text',
    nullable: true,
    select: false,
    transformer: encryptedAdminTotpSecretTransformer,
  })
  mfa_totp_secret: string | null;

  @Column({
    type: 'text',
    nullable: true,
    select: false,
    transformer: encryptedAdminPendingTotpSecretTransformer,
  })
  mfa_pending_totp_secret: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  mfa_pending_expires_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  mfa_enabled_at: Date | null;

  @Column({ type: 'bigint', nullable: true })
  mfa_last_used_time_step: string | null;

  @Column({ type: 'jsonb', nullable: true, select: false })
  mfa_recovery_code_hashes: string[] | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  created_by_admin_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  accepted_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_login_at: Date | null;

  @Index('idx_admin_accounts_deleted_at')
  @Column({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => AdminAccount, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_admin_id' })
  created_by_admin: AdminAccount | null;

  @OneToMany(() => AdminSession, (session) => session.admin)
  sessions: AdminSession[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
