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
import { User } from '../../users/entities/user.entity';
import {
  encryptedJsonFieldTransformer,
  encryptedNullableStringFieldTransformer,
} from '../../skin-profile/skin-profile-field-encryption';
import type {
  Angle,
  AnalysisObservations,
  AnalysisConcern,
  AnalysisStatus,
  CycleMarker,
  OverallFeel,
  PhotoAnalysisInterpretation,
  RatingsPayload,
  RecentChangePayload,
  SleepBand,
  StressLevel,
  SunExposure,
} from '../skin-journal.constants';

const encryptedConcernFocusTransformer = encryptedJsonFieldTransformer<
  string[] | null
>('skin_journal_entries.concern_focus', null);
const encryptedRatingsTransformer =
  encryptedJsonFieldTransformer<RatingsPayload | null>(
    'skin_journal_entries.ratings',
    null,
  );
const encryptedRecentChangeTransformer =
  encryptedJsonFieldTransformer<RecentChangePayload | null>(
    'skin_journal_entries.recent_change',
    null,
  );
const encryptedAnalysisTransformer =
  encryptedJsonFieldTransformer<AnalysisObservations | null>(
    'skin_journal_entries.analysis_observations',
    null,
  );
const encryptedAnalysisInterpretationTransformer =
  encryptedJsonFieldTransformer<PhotoAnalysisInterpretation | null>(
    'skin_journal_entries.analysis_interpretation',
    null,
  );

@Entity('skin_journal_entries')
@Index('UQ_skin_journal_entries_user_date', ['user_id', 'entry_date'], {
  unique: true,
})
@Index('IDX_skin_journal_entries_user_date_desc', ['user_id', 'entry_date'])
export class SkinJournalEntry {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26 })
  user_id: string;

  @Column({ type: 'date' })
  entry_date: string;

  @Column({ type: 'varchar', length: 64 })
  time_zone: string;

  @Column({ type: 'text', nullable: true })
  photo_object_key: string | null;

  @Column({ type: 'integer', nullable: true })
  photo_width: number | null;

  @Column({ type: 'integer', nullable: true })
  photo_height: number | null;

  @Column({ type: 'integer', nullable: true })
  photo_size: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  photo_content_type: string | null;

  @Column({ type: 'boolean', default: false })
  exif_stripped: boolean;

  @Column({ type: 'varchar', length: 20, default: 'head_on' })
  angle: Angle;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedConcernFocusTransformer,
  })
  concern_focus: string[] | null;

  @Column({ type: 'boolean', default: true })
  is_pre_routine: boolean;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedRatingsTransformer,
  })
  ratings: RatingsPayload | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  overall_feel: OverallFeel | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  sleep_band: SleepBand | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  stress_today: StressLevel | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  sun_exposure_today: SunExposure | null;

  @Column({ type: 'boolean', nullable: true })
  sweat_exercise_today: boolean | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cycle_marker: CycleMarker | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedRecentChangeTransformer,
  })
  recent_change: RecentChangePayload | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedNullableStringFieldTransformer(
      'skin_journal_entries.complaint_note',
    ),
  })
  complaint_note: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  analysis_status: AnalysisStatus;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedAnalysisTransformer,
  })
  analysis_observations: AnalysisObservations | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    transformer: encryptedAnalysisInterpretationTransformer,
  })
  analysis_interpretation: PhotoAnalysisInterpretation | null;

  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  analysis_concern_keys: AnalysisConcern[];

  @Column({ type: 'boolean', default: false })
  has_reaction_signal: boolean;

  @Column({ type: 'boolean', default: false })
  needs_retake: boolean;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedNullableStringFieldTransformer(
      'skin_journal_entries.analysis_summary',
    ),
  })
  analysis_summary: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  analysis_model: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  analysis_version: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  analysis_prompt_version: string | null;

  @Column({ type: 'text', nullable: true })
  analysis_error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  analysis_started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  analysis_completed_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  analysis_duration_ms: number | null;

  @Column({ type: 'integer', nullable: true })
  analysis_input_image_count: number | null;

  @Column({ type: 'integer', nullable: true })
  analysis_input_tokens: number | null;

  @Column({ type: 'integer', nullable: true })
  analysis_output_tokens: number | null;

  @Column({ type: 'integer', nullable: true })
  analysis_total_tokens: number | null;

  @Column({ type: 'double precision', nullable: true })
  analysis_estimated_cost_usd: number | null;

  @Column({ type: 'integer', default: 0 })
  analysis_retry_count: number;

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
