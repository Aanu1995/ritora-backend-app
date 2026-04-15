import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { User } from '../../users/entities/user.entity';

@Entity('skin_profiles')
export class SkinProfile {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26, unique: true })
  user_id: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  skin_type: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  skin_tone: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  age_range: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  ethnicity: string | null;

  @Column({ type: 'jsonb', default: [] })
  current_concerns: string[];

  @Column({ type: 'jsonb', default: [] })
  known_sensitivities: string[];

  @Column({ type: 'jsonb', default: [] })
  skin_goals: string[];

  @Column({ type: 'varchar', length: 2, nullable: true })
  country_code: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  routine_complexity: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
