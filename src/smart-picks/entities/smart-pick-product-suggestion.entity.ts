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
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { User } from '../../users/entities/user.entity';
import {
  SmartPicksBudgetTier,
  SmartPicksReasoningChip,
  SmartPicksRuledOutProduct,
} from '../smart-picks.types';

export interface SmartPicksStoredAlternative {
  brand: string;
  productName: string;
  budgetTier: SmartPicksBudgetTier | null;
  sellerNames: string[];
  reasoningChips: SmartPicksReasoningChip[];
  reasoningFacts: Record<string, string>;
  ruledOut: SmartPicksRuledOutProduct[];
  sourceIds: SuggestionEvidenceSourceId[];
  recommendationRankReason: string | null;
}

const encryptedSellerNamesTransformer = encryptedJsonFieldTransformer<string[]>(
  'smart_pick_product_suggestions.seller_names_json',
  [],
);
const encryptedReasoningChipsTransformer = encryptedJsonFieldTransformer<
  SmartPicksReasoningChip[]
>('smart_pick_product_suggestions.reasoning_chips_json', []);
const encryptedReasoningFactsTransformer = encryptedJsonFieldTransformer<
  Record<string, string>
>('smart_pick_product_suggestions.reasoning_facts_json', {});
const encryptedRuledOutTransformer = encryptedJsonFieldTransformer<
  SmartPicksRuledOutProduct[]
>('smart_pick_product_suggestions.ruled_out_json', []);
const encryptedAlternativesTransformer = encryptedJsonFieldTransformer<
  SmartPicksStoredAlternative[]
>('smart_pick_product_suggestions.alternatives_json', []);

@Entity('smart_pick_product_suggestions')
@Index(
  'UQ_smart_pick_product_suggestions_user_key_hash',
  ['user_id', 'normalized_key', 'inputs_hash'],
  { unique: true },
)
@Index('IDX_smart_pick_product_suggestions_user_created', [
  'user_id',
  'created_at',
])
export class SmartPickProductSuggestion {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 160 })
  ingredient_or_category: string;

  @Column({ type: 'varchar', length: 180 })
  normalized_key: string;

  @Column({ type: 'varchar', length: 120 })
  brand: string;

  @Column({ type: 'varchar', length: 200 })
  product_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  budget_tier: SmartPicksBudgetTier | null;

  @Column({ type: 'jsonb', transformer: encryptedSellerNamesTransformer })
  seller_names_json: string[];

  @Column({ type: 'jsonb', transformer: encryptedReasoningChipsTransformer })
  reasoning_chips_json: SmartPicksReasoningChip[];

  @Column({ type: 'jsonb', transformer: encryptedReasoningFactsTransformer })
  reasoning_facts_json: Record<string, string>;

  @Column({ type: 'jsonb', transformer: encryptedRuledOutTransformer })
  ruled_out_json: SmartPicksRuledOutProduct[];

  @Column({ type: 'jsonb', transformer: encryptedAlternativesTransformer })
  alternatives_json: SmartPicksStoredAlternative[];

  @Column({ type: 'text', array: true, default: () => "'{}'::text[]" })
  source_ids: SuggestionEvidenceSourceId[];

  @Column({ type: 'text', nullable: true })
  recommendation_rank_reason: string | null;

  @Column({ type: 'varchar', length: 64 })
  inputs_hash: string;

  @Column({ type: 'text', nullable: true })
  gap_reason: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  goal_alignment: string | null;

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
