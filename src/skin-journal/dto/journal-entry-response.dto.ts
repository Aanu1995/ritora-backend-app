import { ApiProperty } from '@nestjs/swagger';
import { SkinJournalEntry } from '../entities/skin-journal-entry.entity';
import type {
  AnalysisObservations,
  AnalysisStatus,
  Angle,
  CycleMarker,
  OverallFeel,
  RatingsPayload,
  RecentChangePayload,
  SleepBand,
  StressLevel,
  SunExposure,
} from '../skin-journal.constants';

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
  complaint_note: string | null;

  @ApiProperty()
  analysis_status: AnalysisStatus;

  @ApiProperty({ required: false, nullable: true })
  analysis_observations: AnalysisObservations | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_summary: string | null;

  @ApiProperty({ required: false, nullable: true })
  analysis_completed_at: Date | null;

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
  ): JournalEntryResponseDto {
    const dto = new JournalEntryResponseDto();
    dto.id = entry.id;
    dto.entry_date = entry.entry_date;
    dto.time_zone = entry.time_zone;
    dto.photo_url = photoUrl;
    dto.has_photo = !!entry.photo_object_key;
    dto.photo_width = entry.photo_width;
    dto.photo_height = entry.photo_height;
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
    dto.complaint_note = entry.complaint_note;
    dto.analysis_status = entry.analysis_status;
    dto.analysis_observations = entry.analysis_observations;
    dto.analysis_summary = entry.analysis_summary;
    dto.analysis_completed_at = entry.analysis_completed_at;
    dto.analysis_retry_count = entry.analysis_retry_count;
    dto.has_reaction =
      !!entry.analysis_observations?.reaction_signals?.reaction_detected;
    dto.created_at = entry.created_at;
    dto.updated_at = entry.updated_at;
    return dto;
  }
}
