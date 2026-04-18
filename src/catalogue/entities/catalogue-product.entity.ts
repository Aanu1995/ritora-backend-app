import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import type {
  ApplicationGuidance,
  CatalogueIdentity,
  ManufacturerInfo,
  ProductCategory,
} from '../../shelf/shelf.types';

@Entity('catalogue_products')
export class CatalogueProduct {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  brand: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  category: ProductCategory;

  @Column({ type: 'varchar', length: 64, nullable: true })
  barcode: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  brand_search: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name_search: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  identity: CatalogueIdentity;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  guidance: ApplicationGuidance;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  manufacturer: ManufacturerInfo;

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
