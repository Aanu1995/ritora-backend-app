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

const encryptedAdminUserNoteBodyTransformer =
  encryptedNullableStringFieldTransformer('admin_user_notes.body');

@Entity('admin_user_notes')
@Index('idx_admin_user_notes_user_created', ['user_id', 'created_at', 'id'])
@Index('idx_admin_user_notes_author_created', ['author_admin_id', 'created_at'])
export class AdminUserNote {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'varchar', length: 26 })
  author_admin_id: string;

  @Column({
    type: 'text',
    transformer: encryptedAdminUserNoteBodyTransformer,
  })
  body: string;

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
