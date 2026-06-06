import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { ulid } from 'ulid';

@Entity('community_routine_steps')
@Index('idx_community_routine_steps_routine_order', [
  'routine_id',
  'step_order',
])
export class CommunityRoutineStep {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  routine_id: string;

  @Column({ type: 'integer' })
  step_order: number;

  @Column({ type: 'varchar', length: 10 })
  slot: 'am' | 'pm' | 'either';

  @Column({ type: 'varchar', length: 26, nullable: true })
  product_id: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_brand: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_name: string | null;

  @Column({ type: 'varchar', length: 40 })
  category: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  frequency: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
