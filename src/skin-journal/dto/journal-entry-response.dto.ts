import { ApiProperty } from '@nestjs/swagger';
import { SkinJournalEntry } from '../entities/skin-journal-entry.entity';
import { SkinJournalAnalysisFeedback } from '../entities/skin-journal-analysis-feedback.entity';
import { AnalysisFeedbackResponseDto } from './analysis-feedback.dto';
import type {
  AnalysisComparisonReference,
  AnalysisObservations,
  AnalysisFailureCode,
  AnalysisStatus,
  Angle,
  CycleMarker,
  OverallFeel,
  PhotoAnalysisInterpretation,
  PhotoReferenceQuality,
  RatingsPayload,
  RecentChangePayload,
  ReactionReportPayload,
  SleepBand,
  StressLevel,
  SunExposure,
} from '../skin-journal.constants';
import { buildPhotoReferenceQuality } from '../skin-journal-reference-quality';

export class JournalEntryPhotoResponseDto {
  @ApiProperty()
  angle: Angle;

  @ApiProperty()
  photo_url: string;

  @ApiProperty({ required: false, nullable: true })
  width: number | null;

  @ApiProperty({ required: false, nullable: true })
  height: number | null;
}

export class JournalEntryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  entry_date: string;

  @ApiProperty()
  time_zone: string;

  @ApiProperty({ required: false, nullable: true })
  photo_url: string | null;

  @ApiProperty({ required: false, nullable: true })
  photo_thumbnail_url?: string | null;

  @ApiProperty()
  has_photo: boolean;

  @ApiProperty({ required: false, nullable: true })
  photo_width: number | null;

  @ApiProperty({ required: false, nullable: true })
  photo_height: number | null;

  @ApiProperty({ type: [JournalEntryPhotoResponseDto] })
  photos: JournalEntryPhotoResponseDto[];

  @ApiProperty()
  angle_count: number;

  @ApiProperty()
  has_side_photos: boolean;

  @ApiProperty()
  angle: Angle;

  @ApiProperty({ required: false, nullable: true })
  concern_focus: string[] | null;

  @ApiProperty()
  is_pre_routine: boolean;

  @ApiProperty({ required: false, nullable: true })
  ratings: RatingsPayload | null;

  @ApiProperty({ required: false, nullable: true })
  overall_feel: OverallFeel | null;

  @ApiProperty({ required: false, nullable: true })
  sleep_band: SleepBand | null;

  @ApiProperty({ required: false, nullable: true })
  stress_today: StressLevel | null;

  @ApiProperty({ required: false, nullable: true })
  sun_exposure_today: SunExposure | null;

  @ApiProperty({ required: false, nullable: true })
  sweat_exercise_today: boolean | null;

  @ApiProperty({ required: false, nullable: true })
  cycle_marker: CycleMarker | null;

  @ApiProperty({ required: false, nullable: true })
  recent_change: RecentChangePayload | null;

  @ApiProperty({ required: false, nullable: true })
  reaction_report: ReactionReportPayload | null;

  @ApiProperty({ required: false, nullable: true })
  complaint_note: string | null;

  @ApiProperty()
  analysis_status: AnalysisStatus;

  @ApiProperty({ required: false, nullable: true })
  analysis_observations: AnalysisObservations | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_reference: AnalysisComparisonReference | null;

  @ApiProperty()
  photo_reference_quality: PhotoReferenceQuality;

  @ApiProperty({ required: false, nullable: true })
  analysis_interpretation: PhotoAnalysisInterpretation | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_feedback: AnalysisFeedbackResponseDto | null;

  @ApiProperty()
  analysis_feedback_submitted: boolean;

  @ApiProperty({ required: false, nullable: true })
  analysis_feedback_submitted_at: Date | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_summary: string | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_completed_at: Date | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_model: string | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_version: string | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_prompt_version: string | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_error_code: AnalysisFailureCode | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_started_at: Date | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_duration_ms: number | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_input_image_count: number | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_input_tokens: number | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_output_tokens: number | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_total_tokens: number | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_estimated_cost_usd: number | null;

  @ApiProperty()
  analysis_retry_count: number;

  @ApiProperty()
  has_reaction: boolean;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  static fromEntity(
    entry: SkinJournalEntry,
    photoUrl: string | null,
    photos: JournalEntryPhotoResponseDto[] = [],
    analysisFeedback: SkinJournalAnalysisFeedback | null = null,
  ): JournalEntryResponseDto {
    const dto = new JournalEntryResponseDto();
    dto.id = entry.id;
    dto.entry_date = entry.entry_date;
    dto.time_zone = entry.time_zone;
    dto.photo_url = photoUrl;
    dto.has_photo = photos.length > 0 || !!entry.photo_object_key;
    dto.photo_width = entry.photo_width;
    dto.photo_height = entry.photo_height;
    dto.photos = photos;
    dto.angle_count = photos.length || (entry.photo_object_key ? 1 : 0);
    dto.has_side_photos = photos.some((photo) => photo.angle !== 'head_on');
    dto.angle = entry.angle;
    dto.concern_focus = entry.concern_focus;
    dto.is_pre_routine = entry.is_pre_routine;
    dto.ratings = entry.ratings;
    dto.overall_feel = entry.overall_feel;
    dto.sleep_band = entry.sleep_band;
    dto.stress_today = entry.stress_today;
    dto.sun_exposure_today = entry.sun_exposure_today;
    dto.sweat_exercise_today = entry.sweat_exercise_today;
    dto.cycle_marker = entry.cycle_marker;
    dto.recent_change = entry.recent_change;
    dto.reaction_report = hasReactionReportSymptoms(entry.reaction_report)
      ? entry.reaction_report
      : null;
    dto.complaint_note = entry.complaint_note;
    dto.analysis_status = entry.analysis_status;
    dto.analysis_observations = entry.analysis_observations;
    dto.analysis_reference =
      entry.analysis_observations?.comparison_reference ?? null;
    dto.photo_reference_quality = buildPhotoReferenceQuality(entry);
    dto.analysis_interpretation = entry.analysis_interpretation;
    dto.analysis_feedback = matchingAnalysisFeedback(entry, analysisFeedback);
    dto.analysis_feedback_submitted =
      isFeedbackSubmittedForCurrentAnalysis(entry);
    dto.analysis_feedback_submitted_at = dto.analysis_feedback_submitted
      ? entry.analysis_feedback_submitted_at
      : null;
    dto.analysis_summary = entry.analysis_summary;
    dto.analysis_model = entry.analysis_model;
    dto.analysis_version = entry.analysis_version;
    dto.analysis_prompt_version = entry.analysis_prompt_version;
    dto.analysis_error_code = entry.analysis_error_code;
    dto.analysis_started_at = entry.analysis_started_at;
    dto.analysis_completed_at = entry.analysis_completed_at;
    dto.analysis_duration_ms = entry.analysis_duration_ms;
    dto.analysis_input_image_count = entry.analysis_input_image_count;
    dto.analysis_input_tokens = entry.analysis_input_tokens;
    dto.analysis_output_tokens = entry.analysis_output_tokens;
    dto.analysis_total_tokens = entry.analysis_total_tokens;
    dto.analysis_estimated_cost_usd = entry.analysis_estimated_cost_usd;
    dto.analysis_retry_count = entry.analysis_retry_count;
    dto.has_reaction =
      entry.has_reaction_signal ||
      !!entry.analysis_observations?.reaction_signals?.reaction_detected ||
      !!dto.reaction_report;
    dto.created_at = entry.created_at;
    dto.updated_at = entry.updated_at;
    return dto;
  }
}

function hasReactionReportSymptoms(
  report: ReactionReportPayload | null,
): boolean {
  return Boolean(report?.symptoms?.length);
}

function isFeedbackSubmittedForCurrentAnalysis(
  entry: SkinJournalEntry,
): boolean {
  if (!entry.analysis_feedback_submitted || !entry.analysis_interpretation) {
    return false;
  }
  const currentVersion = entry.analysis_interpretation.version ?? null;
  return (
    !!currentVersion &&
    entry.analysis_feedback_interpretation_version === currentVersion
  );
}

function matchingAnalysisFeedback(
  entry: SkinJournalEntry,
  feedback: SkinJournalAnalysisFeedback | null,
): AnalysisFeedbackResponseDto | null {
  if (!feedback) {
    return null;
  }
  const version = entry.analysis_interpretation?.version ?? null;
  if (!version) {
    return null;
  }
  if (feedback.interpretation_version) {
    return feedback.interpretation_version === version
      ? AnalysisFeedbackResponseDto.fromEntity(feedback)
      : null;
  }
  return AnalysisFeedbackResponseDto.fromEntity(feedback);
}
