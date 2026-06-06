import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';

const encryptedFeedbackNoteBodyTransformer =
  encryptedNullableStringFieldTransformer('support_feedback_notes.body');

@Entity('support_feedback_notes')
@Index('idx_support_feedback_notes_feedback_created', [
  'feedback_id',
  'created_at',
  'id',
])
@Index('idx_support_feedback_notes_author_created', [
  'author_admin_id',
  'created_at',
  'id',
])
export class SupportFeedbackNote {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  feedback_id: string;

  @Column({ type: 'varchar', length: 26 })
  author_admin_id: string;

  @Column({
    type: 'text',
    transformer: encryptedFeedbackNoteBodyTransformer,
  })
  body: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}
