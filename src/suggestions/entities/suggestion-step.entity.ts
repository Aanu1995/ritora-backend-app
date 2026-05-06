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
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import { StepLabel } from '../../schedule/dto/schedule.constants';
import {
  encryptedJsonFieldTransformer,
  encryptedNullableStringFieldTransformer,
} from '../../skin-profile/skin-profile-field-encryption';
import {
  SuggestionSafetyFlagJson,
  SuggestionStepChipJson,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import { SuggestionInstance } from './suggestion-instance.entity';

const encryptedStepExplanationTransformer =
  encryptedNullableStringFieldTransformer('suggestion_steps.explanation');
const encryptedStepChipsTransformer = encryptedJsonFieldTransformer<
  SuggestionStepChipJson[] | null
>('suggestion_steps.chips', null);
const encryptedStepSafetyWarningsTransformer = encryptedJsonFieldTransformer<
  SuggestionSafetyFlagJson[] | null
>('suggestion_steps.safety_warnings', null);

@Entity('suggestion_steps')
@Index('IDX_suggestion_steps_instance_order', [
  'suggestion_instance_id',
  'step_order',
])
export class SuggestionStep {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  suggestion_instance_id: string;

  @Column({ type: 'integer' })
  step_order: number;

  @Column({ type: 'varchar', length: 26, nullable: true })
  routine_step_id: string | null;

  @Column({ type: 'varchar', length: 26, nullable: true })
  inventory_product_id: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_brand_snapshot: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_name_snapshot: string | null;

  @Column({ type: 'varchar', length: 30 })
  step_label: StepLabel;

  @Column({ type: 'varchar', length: 100, nullable: true })
  custom_label: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  application_method: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  quantity: string | null;

  @Column({ type: 'integer', nullable: true })
  wait_after_minutes: number | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedStepExplanationTransformer,
  })
  explanation: string | null;

  @Column({ type: 'varchar', length: 20 })
  provenance: SuggestionStepProvenance;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedStepChipsTransformer,
  })
  chips: SuggestionStepChipJson[] | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedStepSafetyWarningsTransformer,
  })
  safety_warnings: SuggestionSafetyFlagJson[] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => SuggestionInstance, (instance) => instance.steps, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'suggestion_instance_id' })
  suggestion_instance: SuggestionInstance;

  @ManyToOne(() => RoutineStep, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'routine_step_id' })
  routine_step: RoutineStep | null;

  @ManyToOne(() => InventoryProduct, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'inventory_product_id' })
  product: InventoryProduct | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
