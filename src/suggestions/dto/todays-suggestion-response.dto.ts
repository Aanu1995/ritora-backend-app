import { ApiProperty } from '@nestjs/swagger';
import {
  EnvironmentAirQualityRisk,
  EnvironmentConfidence,
  EnvironmentHumidityBand,
  EnvironmentProviderName,
  EnvironmentSeason,
  EnvironmentSignalKind,
  EnvironmentStatus,
  EnvironmentTemperatureBand,
  EnvironmentUvRisk,
  EnvironmentWaterHardness,
  EnvironmentWaterSensitivity,
} from '../../environment-intelligence/environment-intelligence.constants';
import { SuggestionEvidenceSourceId } from '../suggestions.constants';
import {
  SUGGESTION_DAYPARTS,
  SUGGESTION_MODES,
  SUGGESTION_SLOT_LIFECYCLE_STATUSES,
  SuggestionDaypart,
  SuggestionMode,
  SuggestionSlotLifecycleStatus,
} from '../suggestions.constants';
import { ApplicationLogResponseDto } from '../../application-tracking/dto/application-log-response.dto';
import { RoutineBreakResponseDto } from './suggestion-routine-break.dto';
import { SuggestionInstanceResponseDto } from './suggestion-instance-response.dto';

const TODAYS_ON_DEMAND_STATUSES = [
  SuggestionSlotLifecycleStatus.Generating,
  SuggestionSlotLifecycleStatus.Ready,
  SuggestionSlotLifecycleStatus.Recorded,
  SuggestionSlotLifecycleStatus.Edited,
  SuggestionSlotLifecycleStatus.Failed,
] as const;

export class TodaysSuggestionWeatherSummaryDto {
  @ApiProperty({ nullable: true })
  temperatureCelsius: number | null;

  @ApiProperty({ nullable: true })
  uvIndex: number | null;

  @ApiProperty({ nullable: true })
  humidity: number | null;

  @ApiProperty({ nullable: true })
  conditionLabel: string | null;
}

export class TodaysSuggestionEnvironmentSummaryDto {
  @ApiProperty({ enum: Object.values(EnvironmentStatus) })
  status: EnvironmentStatus;

  @ApiProperty({ enum: Object.values(EnvironmentProviderName) })
  provider: EnvironmentProviderName;

  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  locationPersonalized: boolean;

  @ApiProperty({ enum: Object.values(EnvironmentSeason) })
  season: EnvironmentSeason;

  @ApiProperty({ nullable: true })
  temperatureCelsius: number | null;

  @ApiProperty({
    nullable: true,
    enum: Object.values(EnvironmentTemperatureBand),
  })
  temperatureBand: EnvironmentTemperatureBand | null;

  @ApiProperty({ nullable: true })
  humidity: number | null;

  @ApiProperty({ nullable: true, enum: Object.values(EnvironmentHumidityBand) })
  humidityBand: EnvironmentHumidityBand | null;

  @ApiProperty({ nullable: true })
  uvIndex: number | null;

  @ApiProperty({ enum: Object.values(EnvironmentUvRisk) })
  uvRisk: EnvironmentUvRisk;

  @ApiProperty({ nullable: true })
  airQualityIndex: number | null;

  @ApiProperty({ enum: Object.values(EnvironmentAirQualityRisk) })
  airQualityRisk: EnvironmentAirQualityRisk;

  @ApiProperty({ nullable: true })
  pm25: number | null;

  @ApiProperty({ nullable: true })
  pm10: number | null;

  @ApiProperty({ nullable: true })
  pollenRisk: string | null;

  @ApiProperty({ nullable: true })
  conditionLabel: string | null;

  @ApiProperty({ enum: Object.values(EnvironmentWaterHardness) })
  waterHardness: EnvironmentWaterHardness;

  @ApiProperty({ enum: Object.values(EnvironmentWaterSensitivity) })
  waterSensitivity: EnvironmentWaterSensitivity;

  @ApiProperty({ type: [String] })
  climateSensitivities: string[];

  @ApiProperty({ enum: Object.values(EnvironmentSignalKind), isArray: true })
  transitionSignals: EnvironmentSignalKind[];

  @ApiProperty({ enum: Object.values(EnvironmentConfidence) })
  confidence: EnvironmentConfidence;

  @ApiProperty()
  stale: boolean;

  @ApiProperty({
    enum: Object.values(SuggestionEvidenceSourceId),
    isArray: true,
  })
  sourceIds: SuggestionEvidenceSourceId[];
}

export class TodaysSuggestionEnvironmentAlertDto {
  @ApiProperty({ enum: Object.values(EnvironmentSignalKind) })
  kind: EnvironmentSignalKind;

  @ApiProperty()
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty({
    enum: Object.values(SuggestionEvidenceSourceId),
    isArray: true,
  })
  sourceIds: SuggestionEvidenceSourceId[];
}

export class TodaysSuggestionReactionAlertDto {
  @ApiProperty()
  detectedAt: string;

  @ApiProperty({ nullable: true })
  simplificationId: string | null;

  @ApiProperty()
  canUseNormalRoutine: boolean;

  @ApiProperty()
  photoEntryId: string;

  @ApiProperty({ nullable: true })
  severity: string | null;

  @ApiProperty({ nullable: true })
  confidence: number | null;

  @ApiProperty({ type: [String] })
  pausedActiveNames: string[];

  @ApiProperty({ type: [String] })
  affectedZones: string[];

  @ApiProperty({ type: [String] })
  indicators: string[];

  @ApiProperty({ type: [String] })
  concernKeys: string[];

  @ApiProperty()
  barrierConcern: boolean;

  @ApiProperty()
  photosUntilClear: number;

  @ApiProperty({ type: [String] })
  clearCriteria: string[];

  @ApiProperty()
  summary: string;
}

export class TodaysSuggestionSpecialistDto {
  @ApiProperty()
  lockedStepCount: number;

  @ApiProperty({ nullable: true })
  providerName: string | null;

  @ApiProperty({ nullable: true })
  clinicName: string | null;

  @ApiProperty({ nullable: true })
  activeSince: string | null;

  @ApiProperty({ nullable: true })
  safetyNetMessage: string | null;
}

export class TodaysSuggestionRecordingDto {
  @ApiProperty()
  applicationLogId: string;

  @ApiProperty({ nullable: true })
  appliedAt: string | null;

  @ApiProperty()
  hasBeenEdited: boolean;

  @ApiProperty()
  editCount: number;

  @ApiProperty({ nullable: true })
  lastEditedAt: string | null;

  @ApiProperty()
  appliedCount: number;

  @ApiProperty()
  totalItems: number;
}

export class TodaysSuggestionSlotDto {
  @ApiProperty()
  slotId: string;

  @ApiProperty({ enum: SUGGESTION_DAYPARTS })
  daypart: SuggestionDaypart;

  @ApiProperty()
  slotTime: string;

  @ApiProperty({ enum: SUGGESTION_MODES })
  mode: SuggestionMode;

  @ApiProperty({ nullable: true })
  slotNotes: string | null;

  @ApiProperty()
  routineStepCount: number;

  @ApiProperty()
  specialistLockedStepCount: number;

  @ApiProperty({ nullable: true, type: () => TodaysSuggestionSpecialistDto })
  specialist: TodaysSuggestionSpecialistDto | null;

  @ApiProperty()
  visibleAt: string;

  @ApiProperty()
  isVisible: boolean;

  @ApiProperty({ enum: SUGGESTION_SLOT_LIFECYCLE_STATUSES })
  status: SuggestionSlotLifecycleStatus;

  @ApiProperty()
  slotStartsAt: string;

  @ApiProperty()
  recordableAt: string;

  @ApiProperty()
  expiresAt: string;

  @ApiProperty({ nullable: true, type: () => TodaysSuggestionRecordingDto })
  recording: TodaysSuggestionRecordingDto | null;

  @ApiProperty({ nullable: true })
  recordingReminderSnoozedUntil: string | null;

  @ApiProperty({ nullable: true, type: () => ApplicationLogResponseDto })
  applicationLog: ApplicationLogResponseDto | null;

  @ApiProperty({ nullable: true, type: SuggestionInstanceResponseDto })
  suggestion: SuggestionInstanceResponseDto | null;
}

export class TodaysOnDemandSuggestionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: TODAYS_ON_DEMAND_STATUSES })
  status: Extract<
    SuggestionSlotLifecycleStatus,
    | typeof SuggestionSlotLifecycleStatus.Generating
    | typeof SuggestionSlotLifecycleStatus.Ready
    | typeof SuggestionSlotLifecycleStatus.Recorded
    | typeof SuggestionSlotLifecycleStatus.Edited
    | typeof SuggestionSlotLifecycleStatus.Failed
  >;

  @ApiProperty()
  requestedAt: string;

  @ApiProperty({ nullable: true, type: () => TodaysSuggestionRecordingDto })
  recording: TodaysSuggestionRecordingDto | null;

  @ApiProperty({ nullable: true, type: () => ApplicationLogResponseDto })
  applicationLog: ApplicationLogResponseDto | null;

  @ApiProperty({ type: SuggestionInstanceResponseDto })
  suggestion: SuggestionInstanceResponseDto;
}

export class TodaysSuggestionSummaryDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  locked: number;

  @ApiProperty()
  upcoming: number;

  @ApiProperty()
  ready: number;

  @ApiProperty()
  recordable: number;

  @ApiProperty()
  recorded: number;

  @ApiProperty()
  edited: number;

  @ApiProperty()
  failed: number;

  @ApiProperty()
  onDemand: number;
}

export class TodaysSuggestionResponseDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  timeZone: string;

  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  leadTimeMinutes: number;

  @ApiProperty({ type: TodaysSuggestionSummaryDto })
  summary: TodaysSuggestionSummaryDto;

  @ApiProperty({ nullable: true, type: TodaysSuggestionWeatherSummaryDto })
  weatherSummary: TodaysSuggestionWeatherSummaryDto | null;

  @ApiProperty({
    nullable: true,
    type: TodaysSuggestionEnvironmentSummaryDto,
  })
  environmentSummary: TodaysSuggestionEnvironmentSummaryDto | null;

  @ApiProperty({ type: [TodaysSuggestionEnvironmentAlertDto] })
  environmentAlerts: TodaysSuggestionEnvironmentAlertDto[];

  @ApiProperty({ type: [TodaysSuggestionSlotDto] })
  slots: TodaysSuggestionSlotDto[];

  @ApiProperty({ type: [TodaysOnDemandSuggestionDto] })
  onDemandSuggestions: TodaysOnDemandSuggestionDto[];

  @ApiProperty({ nullable: true, type: TodaysSuggestionReactionAlertDto })
  reactionAlert: TodaysSuggestionReactionAlertDto | null;

  @ApiProperty({ nullable: true, type: RoutineBreakResponseDto })
  routineBreak: RoutineBreakResponseDto | null;
}
