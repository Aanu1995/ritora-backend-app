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
  SmartPicksAvailabilityStatus,
  SmartPicksBudgetTier,
  SmartPicksReasoningChip,
  SmartPicksRetailer,
  SmartPicksRuledOutProduct,
} from '../smart-picks.types';

export interface SmartPicksStoredAlternative {
  brand: string;
  productName: string;
  budgetTier: SmartPicksBudgetTier | null;
  priceCents: number | null;
  currency: string | null;
  retailers: SmartPicksRetailer[];
  reasoningChips: SmartPicksReasoningChip[];
  reasoningFacts: Record<string, string>;
  ruledOut: SmartPicksRuledOutProduct[];
  sourceIds: SuggestionEvidenceSourceId[];
  availabilityStatus: SmartPicksAvailabilityStatus;
  recommendationRankReason: string | null;
  localAlternativeReason: string | null;
}

const encryptedRetailersTransformer = encryptedJsonFieldTransformer<
  SmartPicksRetailer[]
>('smart_pick_product_suggestions.retailers_json', []);
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
  'UQ_smart_pick_product_suggestions_user_key',
  ['user_id', 'normalized_key'],
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

  @Column({ type: 'integer', nullable: true })
  price_cents: number | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency: string | null;

  @Column({ type: 'jsonb', transformer: encryptedRetailersTransformer })
  retailers_json: SmartPicksRetailer[];

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

  @Column({ type: 'varchar', length: 20, default: 'ai_named' })
  verification_status: 'ai_named' | 'unavailable';

  @Column({ type: 'varchar', length: 24, default: 'unknown' })
  availability_status: SmartPicksAvailabilityStatus;

  @Column({ type: 'text', nullable: true })
  recommendation_rank_reason: string | null;

  @Column({ type: 'text', nullable: true })
  local_alternative_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  retailer_data_checked_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  retailer_data_expires_at: Date | null;

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
