import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export const COMMUNITY_SETTINGS_ID = 'default';
export const DEFAULT_COMMUNITY_MIN_ACCOUNT_AGE_DAYS = 3;
export const MAX_COMMUNITY_MIN_ACCOUNT_AGE_DAYS = 30;

@Entity('community_settings')
export class CommunitySettings {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({
    type: 'integer',
    default: DEFAULT_COMMUNITY_MIN_ACCOUNT_AGE_DAYS,
  })
  minimum_account_age_days: number;

  @Column({ type: 'varchar', length: 26, nullable: true })
  updated_by_admin_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
