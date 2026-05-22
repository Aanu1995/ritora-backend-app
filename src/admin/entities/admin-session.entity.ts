import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { AdminAccount } from './admin-account.entity';

@Entity('admin_sessions')
export class AdminSession {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Index('idx_admin_sessions_admin_id')
  @Column({ type: 'varchar', length: 26 })
  admin_id: string;

  @Column({ type: 'varchar', length: 255 })
  refresh_token_hash: string;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  user_agent: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz' })
  last_used_at: Date;

  @ManyToOne(() => AdminAccount, (admin) => admin.sessions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'admin_id' })
  admin: AdminAccount;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
