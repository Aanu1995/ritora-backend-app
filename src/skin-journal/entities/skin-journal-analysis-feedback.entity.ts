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
import type {
  AnalysisFeedbackReason,
  AnalysisFeedbackVote,
  PhotoAnalysisReadingLabel,
} from '../skin-journal.constants';

export const skinJournalAnalysisFeedbackNoteTransformer =
  encryptedNullableStringFieldTransformer(
    'skin_journal_analysis_feedback.note',
  );

@Entity('skin_journal_analysis_feedback')
@Index('IDX_skin_journal_analysis_feedback_vote_created', [
  'vote',
  'created_at',
])
@Index('IDX_skin_journal_analysis_feedback_reason_created', [
  'reason',
  'created_at',
])
export class SkinJournalAnalysisFeedback {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 20 })
  vote: AnalysisFeedbackVote;

  @Column({ type: 'varchar', length: 40, nullable: true })
  reason: AnalysisFeedbackReason | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: skinJournalAnalysisFeedbackNoteTransformer,
  })
  note: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  interpretation_version: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  reading_label: PhotoAnalysisReadingLabel | null;

  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  concern_keys: string[];

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
