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
import {
  type ApplicationGuidance,
  type CatalogueIdentity,
  DataProvenance,
  ProductCategory,
  type ManufacturerInfo,
  ProductIntroductionStatus,
  ShelfStatus,
  type UserFields,
} from '../../shelf/shelf.types';
import { User } from '../../users/entities/user.entity';

@Entity('inventory_products')
@Index('IDX_inventory_products_user_created', ['user_id', 'created_at'])
@Index('IDX_inventory_products_user_status', ['user_id', 'status'])
@Index('IDX_inventory_products_user_brand', ['user_id', 'brand_search'])
@Index('IDX_inventory_products_user_name', ['user_id', 'name_search'])
@Index('IDX_inventory_products_user_effective_expires', [
  'user_id',
  'effective_expires_at',
])
@Index('IDX_inventory_products_user_introduction_status', [
  'user_id',
  'introduction_status',
])
export class InventoryProduct {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 255 })
  brand: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  category: ProductCategory;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode: string | null;

  @Column({ type: 'varchar', length: 30, default: ShelfStatus.Active })
  status: ShelfStatus;

  @Column({ type: 'varchar', length: 30 })
  provenance: DataProvenance;

  @Column({ type: 'varchar', length: 255 })
  brand_search: string;

  @Column({ type: 'varchar', length: 255 })
  name_search: string;

  @Column({ type: 'text', default: '' })
  search_document: string;

  @Column({ type: 'timestamptz', nullable: true })
  opened_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  period_after_opening_months: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  effective_expires_at: Date | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  introduction_status: ProductIntroductionStatus | null;

  @Column({ type: 'timestamptz', nullable: true })
  introduction_started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  introduction_status_updated_at: Date | null;

  @Column({ type: 'jsonb' })
  identity: CatalogueIdentity;

  @Column({ type: 'jsonb' })
  guidance: ApplicationGuidance;

  @Column({ type: 'jsonb' })
  manufacturer: ManufacturerInfo;

  @Column({ type: 'jsonb' })
  user_fields: UserFields;

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
