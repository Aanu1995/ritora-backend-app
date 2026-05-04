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
import { StepLabel } from '../dto/schedule.constants';
import { ScheduleSlot } from './schedule-slot.entity';

@Entity('routine_steps')
@Index('IDX_routine_steps_slot_order', ['slot_id', 'step_order'])
export class RoutineStep {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  slot_id: string;

  @Column({ type: 'integer' })
  step_order: number;

  @Column({ type: 'varchar', length: 26, nullable: true })
  inventory_product_id: string | null;

  @Column({ type: 'varchar', length: 30 })
  step_label: StepLabel;

  @Column({ type: 'varchar', length: 100, nullable: true })
  custom_label: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'boolean', default: false })
  optional: boolean;

  @Column({ type: 'boolean', default: false })
  is_specialist_locked: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => ScheduleSlot, (slot) => slot.steps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slot_id' })
  slot: ScheduleSlot;

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
