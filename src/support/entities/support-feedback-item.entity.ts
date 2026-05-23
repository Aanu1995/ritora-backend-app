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
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';

export enum SupportFeedbackSource {
  UserWebApp = 'user_web_app',
  SupportEmail = 'support_email',
  AppStoreReview = 'app_store_review',
  AdminCreated = 'admin_created',
  Other = 'other',
}

export enum SupportFeedbackType {
  Bug = 'bug',
  Suggestion = 'suggestion',
  ConfusingResult = 'confusing_result',
  UnsafeRecommendation = 'unsafe_recommendation',
  ProductDataIssue = 'product_data_issue',
  BillingPricing = 'billing_pricing',
  Account = 'account',
  Other = 'other',
}

export enum SupportFeedbackStatus {
  New = 'new',
  Triaged = 'triaged',
  Planned = 'planned',
  Fixed = 'fixed',
  Closed = 'closed',
}

export enum SupportFeedbackPriority {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

export const encryptedFeedbackDescriptionTransformer =
  encryptedNullableStringFieldTransformer('support_feedback_items.description');

@Entity('support_feedback_items')
@Index('idx_support_feedback_status_priority_updated', [
  'status',
  'priority',
  'updated_at',
  'id',
])
@Index('idx_support_feedback_assigned_status_updated', [
  'assigned_admin_id',
  'status',
  'updated_at',
  'id',
])
@Index('idx_support_feedback_user_status_updated', [
  'user_id',
  'status',
  'updated_at',
  'id',
])
@Index('idx_support_feedback_type_status_updated', [
  'type',
  'status',
  'updated_at',
  'id',
])
export class SupportFeedbackItem {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 320, nullable: true })
  reporter_email: string | null;

  @Column({
    type: 'enum',
    enum: SupportFeedbackSource,
    enumName: 'support_feedback_source',
  })
  source: SupportFeedbackSource;

  @Column({
    type: 'enum',
    enum: SupportFeedbackType,
    enumName: 'support_feedback_type',
  })
  type: SupportFeedbackType;

  @Column({
    type: 'enum',
    enum: SupportFeedbackStatus,
    enumName: 'support_feedback_status',
    default: SupportFeedbackStatus.New,
  })
  status: SupportFeedbackStatus;

  @Column({
    type: 'enum',
    enum: SupportFeedbackPriority,
    enumName: 'support_feedback_priority',
    default: SupportFeedbackPriority.Medium,
  })
  priority: SupportFeedbackPriority;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({
    type: 'text',
    transformer: encryptedFeedbackDescriptionTransformer,
  })
  description: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  context: Record<string, string>;

  @Column({ type: 'varchar', length: 26, nullable: true })
  assigned_admin_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  created_by_admin_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  closed_by_admin_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
