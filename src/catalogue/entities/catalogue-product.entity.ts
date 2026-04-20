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
  CatalogueSource,
  CatalogueIdentity,
  LookupConfidence,
  LookupWarningCode,
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

  @Column({ type: 'varchar', length: 50, default: 'ritora-catalogue' })
  source_type: CatalogueSource;

  @Column({ type: 'varchar', length: 255, nullable: true })
  source_id: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  source_url: string | null;

  @Column({ type: 'varchar', length: 20, default: 'high' })
  confidence: LookupConfidence;

  @Column({ type: 'boolean', default: false })
  review_required: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  warnings: LookupWarningCode[];

  @Column({ type: 'jsonb', default: () => "'{}'" })
  raw_source: Record<string, unknown>;

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

  @Column({ type: 'timestamptz', nullable: true })
  last_synced_at: Date | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
