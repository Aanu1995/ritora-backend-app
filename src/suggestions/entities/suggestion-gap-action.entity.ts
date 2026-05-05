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
import { User } from '../../users/entities/user.entity';
import { SuggestionGapActionKind } from '../suggestions.constants';
import { SuggestionInstance } from './suggestion-instance.entity';

@Entity('suggestion_gap_actions')
@Index(
  'UQ_suggestion_gap_actions_user_suggestion_key',
  ['user_id', 'suggestion_instance_id', 'normalized_key'],
  { unique: true },
)
@Index('IDX_suggestion_gap_actions_user_created', ['user_id', 'created_at'])
export class SuggestionGapAction {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  suggestion_instance_id: string;

  @Column({ type: 'varchar', length: 160 })
  ingredient_or_category: string;

  @Column({ type: 'varchar', length: 180 })
  normalized_key: string;

  @Column({ type: 'varchar', length: 20 })
  action: SuggestionGapActionKind;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => SuggestionInstance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'suggestion_instance_id' })
  suggestion_instance: SuggestionInstance;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
