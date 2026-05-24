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
import {
  CommunityDisclosureType,
  CommunityModerationStatus,
  type CommunityOutcomeSignal,
  CommunityReviewRoutineSlot,
  CommunityReviewSkinResponse,
  type CommunitySafeProfileFacets,
  type CommunitySafetyFlag,
} from '../community.types';

@Entity('community_reviews')
@Index('idx_community_reviews_status_updated', [
  'moderation_status',
  'updated_at',
])
@Index('idx_community_reviews_product_status', [
  'product_id',
  'moderation_status',
])
export class CommunityReview {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  author_user_id: string;

  @Column({ type: 'varchar', length: 26 })
  community_profile_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  product_id: string | null;

  @Column({ type: 'varchar', length: 255 })
  product_brand: string;

  @Column({ type: 'varchar', length: 255 })
  product_name: string;

  @Column({ type: 'varchar', length: 40 })
  product_category: string;

  @Column({ type: 'varchar', length: 30 })
  disclosure_type: CommunityDisclosureType;

  @Column({ type: 'varchar', length: 30 })
  usage_duration: string;

  @Column({ type: 'varchar', length: 50 })
  frequency: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  routine_slot: CommunityReviewRoutineSlot | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  skin_response: CommunityReviewSkinResponse | null;

  @Column({ type: 'integer', nullable: true })
  overall_rating: number | null;

  @Column({ type: 'integer', nullable: true })
  effectiveness_rating: number | null;

  @Column({ type: 'integer', nullable: true })
  irritation_rating: number | null;

  @Column({ type: 'integer', nullable: true })
  texture_rating: number | null;

  @Column({ type: 'integer', nullable: true })
  value_rating: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  outcomes: string[];

  @Column({ type: 'varchar', length: 30 })
  repurchase: string;

  @Column({ type: 'varchar', length: 1200, nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 30 })
  moderation_status: CommunityModerationStatus;

  @Column({ type: 'varchar', length: 26, nullable: true })
  assigned_admin_id: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  safe_facets: CommunitySafeProfileFacets;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  safety_flags: CommunitySafetyFlag[];

  @Column({ type: 'integer', default: 0 })
  helpful_count: number;

  @Column({ type: 'integer', default: 0 })
  not_helpful_count: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  outcome_signal_counts: Partial<Record<CommunityOutcomeSignal, number>>;

  @Column({ type: 'timestamptz', nullable: true })
  withdrawn_at: Date | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  withdrawn_by_user_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
