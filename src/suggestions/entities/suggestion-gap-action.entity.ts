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
import { SmartPickProductSuggestion } from '../../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SuggestionGapActionKind } from '../suggestions.constants';
import { SuggestionInstance } from './suggestion-instance.entity';

export type SuggestionGapActionSourceType = 'today' | 'smart_pick';

@Entity('suggestion_gap_actions')
@Index(
  'UQ_suggestion_gap_actions_today_user_suggestion_key',
  ['user_id', 'suggestion_instance_id', 'normalized_key'],
  {
    unique: true,
    where: `"source_type" = 'today' AND "suggestion_instance_id" IS NOT NULL`,
  },
)
@Index(
  'UQ_suggestion_gap_actions_smart_pick_user_suggestion_key',
  ['user_id', 'smart_pick_product_suggestion_id', 'normalized_key'],
  {
    unique: true,
    where: `"source_type" = 'smart_pick' AND "smart_pick_product_suggestion_id" IS NOT NULL`,
  },
)
@Index('IDX_suggestion_gap_actions_user_created', ['user_id', 'created_at'])
@Index('IDX_suggestion_gap_actions_user_source_action', [
  'user_id',
  'source_type',
  'action',
])
export class SuggestionGapAction {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 20, default: 'today' })
  source_type: SuggestionGapActionSourceType;

  @Column({ type: 'varchar', length: 26, nullable: true })
  suggestion_instance_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  smart_pick_product_suggestion_id: string | null;

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

  @ManyToOne(() => SuggestionInstance, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'suggestion_instance_id' })
  suggestion_instance: SuggestionInstance | null;

  @ManyToOne(() => SmartPickProductSuggestion, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'smart_pick_product_suggestion_id' })
  smart_pick_product_suggestion: SmartPickProductSuggestion | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
