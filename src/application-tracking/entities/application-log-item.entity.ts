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
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  encryptedJsonFieldTransformer,
  encryptedNullableStringFieldTransformer,
} from '../../skin-profile/skin-profile-field-encryption';
import { SuggestionStep } from '../../suggestions/entities/suggestion-step.entity';
import {
  ApplicationItemProductSnapshot,
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../application-tracking.constants';
import { ApplicationLog } from './application-log.entity';

const encryptedItemNotesTransformer = encryptedNullableStringFieldTransformer(
  'application_log_items.notes',
);
const encryptedSubstitutionReasonTransformer =
  encryptedNullableStringFieldTransformer(
    'application_log_items.substitution_reason',
  );
const encryptedRecommendedSnapshotTransformer =
  encryptedJsonFieldTransformer<ApplicationItemProductSnapshot | null>(
    'application_log_items.recommended_snapshot',
    null,
  );
const encryptedAppliedSnapshotTransformer =
  encryptedJsonFieldTransformer<ApplicationItemProductSnapshot | null>(
    'application_log_items.applied_snapshot',
    null,
  );

@Entity('application_log_items')
@Index('IDX_application_items_log_order', ['application_log_id', 'step_order'])
@Index(
  'IDX_application_items_inventory_product_usage',
  ['inventory_product_id', 'status', 'application_log_id'],
  { where: '"inventory_product_id" IS NOT NULL' },
)
@Index(
  'IDX_application_items_substituted_product_usage',
  ['substituted_with_product_id', 'status', 'application_log_id'],
  { where: '"substituted_with_product_id" IS NOT NULL' },
)
export class ApplicationLogItem {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  application_log_id: string;

  @Column({ type: 'integer' })
  step_order: number;

  @Column({ type: 'varchar', length: 26, nullable: true })
  suggestion_step_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  inventory_product_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  substituted_with_product_id: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_brand_snapshot: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_name_snapshot: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  step_label: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: ApplicationItemStatus;

  @Column({ type: 'boolean', default: false })
  is_ad_hoc: boolean;

  @Column({ type: 'varchar', length: 30, default: 'recommended' })
  item_source: ApplicationItemSource;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ad_hoc_brand: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ad_hoc_name: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedItemNotesTransformer,
  })
  notes: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSubstitutionReasonTransformer,
  })
  substitution_reason: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedRecommendedSnapshotTransformer,
  })
  recommended_snapshot: ApplicationItemProductSnapshot | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedAppliedSnapshotTransformer,
  })
  applied_snapshot: ApplicationItemProductSnapshot | null;

  @Column({ type: 'timestamptz', nullable: true })
  applied_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => ApplicationLog, (log) => log.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_log_id' })
  application_log: ApplicationLog;

  @ManyToOne(() => SuggestionStep, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'suggestion_step_id' })
  suggestion_step: SuggestionStep | null;

  @ManyToOne(() => InventoryProduct, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'inventory_product_id' })
  product: InventoryProduct | null;

  @ManyToOne(() => InventoryProduct, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'substituted_with_product_id' })
  substituted_with_product: InventoryProduct | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
