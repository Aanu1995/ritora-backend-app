import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';

export type CatalogueSourceRuleMatchType =
  | 'hostname_contains'
  | 'hostname_equals'
  | 'hostname_suffix';

export type CatalogueSourceRuleEffect = 'block' | 'penalize' | 'prefer';

@Entity('catalogue_source_rules')
export class CatalogueSourceRule {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  label: string;

  @Column({ type: 'varchar', length: 255 })
  host_pattern: string;

  @Column({ type: 'varchar', length: 30 })
  match_type: CatalogueSourceRuleMatchType;

  @Column({ type: 'varchar', length: 20 })
  effect: CatalogueSourceRuleEffect;

  @Column({ type: 'integer', default: 0 })
  score_adjustment: number;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string | null;

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
