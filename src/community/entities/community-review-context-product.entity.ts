import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { ulid } from 'ulid';

@Entity('community_review_context_products')
@Index('idx_community_review_context_review', ['review_id'])
export class CommunityReviewContextProduct {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  review_id: string;

  @Column({ type: 'varchar', length: 26, nullable: true })
  product_id: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_brand: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_name: string | null;

  @Column({ type: 'varchar', length: 40 })
  category: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) this.id = ulid();
  }
}
