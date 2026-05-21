import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  Brackets,
  FindOptionsWhere,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
  SelectQueryBuilder,
  EntityManager,
} from 'typeorm';
import { createHash } from 'crypto';
import { decodeCursor, encodeCursor } from '../common/utils/cursor-pagination';
import { nowDate } from '../common/utils/date';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  NotificationKind,
  NotificationSeverity,
} from '../notifications/entities/in-app-notification.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import {
  SkinProfile,
  type ConcernDetail,
} from '../skin-profile/entities/skin-profile.entity';
import { getSensitiveSkinProfileConsentTypes } from '../skin-profile/skin-profile-sensitive-data';
import {
  hasCompletedEssentialSkinProfile,
  skinProfileRequiredException,
} from '../skin-profile/skin-profile-completion';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  UserConsentType,
  UserDataAccessActorType,
  UserDataAccessEventType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { SkinJournalEntryPhoto } from './entities/skin-journal-entry-photo.entity';
import { SkinJournalEvent } from './entities/skin-journal-event.entity';
import { SkinJournalInsight } from './entities/skin-journal-insight.entity';
import { SkinJournalInsightInteraction } from './entities/skin-journal-insight-interaction.entity';
import { SkinJournalInsightGenerationRun } from './entities/skin-journal-insight-generation-run.entity';
import { SkinJournalInsightJob } from './entities/skin-journal-insight-job.entity';
import { SkinJournalInsightState } from './entities/skin-journal-insight-state.entity';
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { SkinJournalAnalysisJob } from './entities/skin-journal-analysis-job.entity';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { SkinJournalExportJob } from './entities/skin-journal-export-job.entity';
import { SkinJournalPhotoStorageService } from './services/skin-journal-photo-storage.service';
import { SkinJournalAnalysisService } from './services/skin-journal-analysis.service';
import { classifyAnalysisFailure } from './services/skin-journal-analysis-errors';
import {
  AnalysisPhotoPreflightIssue,
  AnalysisPhotoPreflightIssueValue,
  parseAnalysisPhotoPreflightIssues,
} from './services/skin-journal-analysis-preflight';
import { SkinJournalPhotoInterpretationService } from './services/skin-journal-photo-interpretation.service';
import {
  AnalysisQueueMetrics,
  SkinJournalAnalysisQueueService,
} from './services/skin-journal-analysis-queue.service';
import { SkinJournalInsightQueueService } from './services/skin-journal-insight-queue.service';
import { SkinJournalMediaRetentionService } from './services/skin-journal-media-retention.service';
import { UpsertEntryDto } from './dto/upsert-entry.dto';
import {
  CreateJournalExportDto,
  JournalExportResponseDto,
} from './dto/export-journal.dto';
import {
  CalendarDayDto,
  CalendarDayState,
  CalendarDayStateValue,
  CalendarResponseDto,
} from './dto/calendar-response.dto';
import {
  JournalEntryPhotoResponseDto,
  JournalEntryResponseDto,
} from './dto/journal-entry-response.dto';
import { DayDetailResponseDto } from './dto/day-detail-response.dto';
import { JournalEventResponseDto } from './dto/event-response.dto';
import {
  JournalInsightResponseDto,
  JournalInsightsResponseDto,
} from './dto/insight-response.dto';
import { JournalStatsResponseDto } from './dto/stats-response.dto';
import { WrappedResponseDto } from './dto/wrapped-response.dto';
import { SimplificationResponseDto } from './dto/simplification-response.dto';
import { PhotoDatesResponseDto } from './dto/photo-dates-response.dto';
import {
  PhotoFilterOptionDto,
  PhotoFiltersResponseDto,
} from './dto/photo-filters-response.dto';
import { PhotoPageResponseDto } from './dto/photo-page-response.dto';
import {
  ANALYSIS_CONCERNS,
  AnalysisPhotoInput,
  AnalysisObservations,
  CONCERN_KEYS,
  PHOTO_FILTER_ALL_ID,
  PHOTO_FILTER_CONCERN_PREFIX,
  PHOTO_FILTER_REACTION_ID,
  type ConcernKey,
  type AnalysisConcern,
  EventKind,
  InsightKind,
  InsightWindow,
  InsightGenerationTrigger,
  InsightInteractionTypeValue,
  RatingsPayload,
  SKIN_JOURNAL_AI_NO_FACE_RATE_ML_REVIEW_THRESHOLD,
  SKIN_JOURNAL_ANALYSIS_CAPACITY_RETRY_DELAY_MS,
  SKIN_JOURNAL_ANALYSIS_FAILURE_RATE_ALERT_THRESHOLD,
  SKIN_JOURNAL_ANALYSIS_QUEUE_AGE_ALERT_SECONDS,
  SKIN_JOURNAL_ANALYSIS_RECOVERY_INTERVAL_MS,
  SKIN_JOURNAL_INSIGHT_PATTERN_CARDS_ENABLED,
  SKIN_JOURNAL_INSIGHT_FAILED_RETRY_COOLDOWN_DAYS,
  SKIN_JOURNAL_INSIGHT_MIN_ENTRIES_FOR_PERIODIC_GENERATION,
  SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
  SKIN_JOURNAL_INSIGHT_SUMMARY_CARDS_ENABLED,
  SKIN_JOURNAL_LOCAL_FACE_REJECTION_RATE_ML_REVIEW_THRESHOLD,
  SKIN_JOURNAL_PHOTO_PAGE_DEFAULT_LIMIT,
  SKIN_JOURNAL_PHOTO_PAGE_MAX_LIMIT,
  SKIN_JOURNAL_PHOTO_ANGLES,
  SKIN_JOURNAL_WRAPPED_ENABLED,
  SkinJournalExportPayload,
  type Angle,
  AnalysisStatus,
  AnalysisStatusValue,
  AnalysisFailureCode,
  AnalysisFailureCodeValue,
  AnalysisEntryContext,
  AnalysisSkinContext,
  CompareDeltaBullet,
  CompareDeltaSeverity,
  ExportStatusValue,
  InsightGenerationStatusValue,
  PhotoReferenceQualityReason,
} from './skin-journal.constants';
import {
  buildAnalysisComparisonReference,
  buildPhotoReferenceQuality,
  selectAnalysisReferenceEntry,
  withAnalysisComparisonReference,
} from './skin-journal-reference-quality';
import {
  isValidDate,
  listDatesInRange,
  monthRange,
  resolveSkinJournalTimeZone,
  todayInTimeZone,
} from './skin-journal.utils';
import {
  buildDeterministicInsights,
  isModerateOrSevereReaction,
  strongestWorsening,
} from './skin-journal-insight-detectors';
import {
  toExportEntryRecord,
  toExportEventRecord,
  toExportInsightRecord,
  toExportResponse,
  toExportSimplificationRecord,
  toWrappedExportRecord,
  toWrappedResponseDto,
} from './skin-journal-export.mapper';
import { normalizeUpsertEntryBody } from './skin-journal-multipart.parser';
import {
  InsightPolishService,
  type InsightPolishUsage,
} from './insights/insight-polish.service';
import { KnowledgeBaseService } from './insights/knowledge-base/knowledge-base.service';
import type { InsightBlock, InsightCandidate } from './insights/insight-types';
import type { InsightAction } from './insights/insight-types';
import { SmartPicksPreparationService } from '../smart-picks/services/smart-picks-preparation.service';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import type { RoutineApplicationEvidence } from './skin-journal-insight-detectors';
import { User } from '../users/entities/user.entity';
import {
  INSIGHT_CADENCE_DEFAULT,
  INSIGHT_CADENCE_INTERVAL_DAYS,
  INSIGHT_DIGEST_DAY_DEFAULT,
  INSIGHT_DIGEST_LOCAL_TIME_DEFAULT,
  type InsightCadence,
} from '../notifications/notifications.constants';

interface InsightEntryPreview {
  entry_id: string;
  date: string;
  photo_url: string | null;
}

type PhotoUploadInput = { buffer: Buffer; contentType: string };
type PhotoUploadMap = Partial<Record<Angle, PhotoUploadInput>>;
type EntryPhotoRowsByEntryId = Map<string, SkinJournalEntryPhoto[]>;

export interface AngleQualityOperationsMetric {
  count: number;
  average_quality_score: number | null;
  needs_retake_rate: number;
  face_missing_rate: number;
  used_for_analysis_rate: number;
  poor_quality_rate: number;
}

export type AngleQualityOperationsMetrics = Record<
  Angle,
  AngleQualityOperationsMetric
>;

export interface PhotoPreflightOperationsMetrics {
  rejected_count: number;
  issue_counts: Partial<Record<AnalysisPhotoPreflightIssue, number>>;
  local_face_rejection_rate: number;
  ai_no_face_rate: number;
  ml_detector_review_recommended: boolean;
  ml_detector_review_reasons: string[];
}

export interface AnalysisOperationsMetrics {
  window_hours: number;
  completed_count: number;
  failed_count: number;
  needs_review_count: number;
  average_duration_ms: number | null;
  average_input_image_count: number | null;
  multi_angle_rate: number;
  failure_rate: number;
  retake_rate: number;
  safety_flag_rate: number;
  estimated_cost_usd: number;
  total_tokens: number;
  failure_codes: Partial<Record<AnalysisFailureCode, number>>;
  photo_preflight: PhotoPreflightOperationsMetrics;
  per_angle_quality: AngleQualityOperationsMetrics;
  concern_counts: Partial<Record<AnalysisConcern, number>>;
}

export interface InsightUsefulnessKindMetric {
  generated_count: number;
  seen_count: number;
  dismissed_count: number;
  action_click_count: number;
  seen_rate: number;
  dismissed_rate: number;
  action_click_rate: number;
}

export interface InsightEvaluationCaseHint {
  insight_kind: InsightKind;
  reason: 'high_dismissal_rate' | 'low_action_click_rate';
  value: number;
  threshold: number;
}

export interface InsightUsefulnessOperationsMetrics extends InsightUsefulnessKindMetric {
  window_hours: number;
  by_kind: Partial<Record<InsightKind, InsightUsefulnessKindMetric>>;
  evaluation_case_hints: InsightEvaluationCaseHint[];
}

type StoredAnglePhoto = {
  angle: Angle;
  object_key: string;
  width: number | null;
  height: number | null;
  size: number;
  content_type: string;
  exif_stripped: boolean;
};

const SKIN_PROGRESS_CONSENT = UserConsentType.SkinProgressProcessing;
const NOTIFICATION_KEYS = {
  analysisFailedTitle: 'skinJournal.notifications.analysisFailed.title',
  analysisFailedBody: 'skinJournal.notifications.analysisFailed.body',
  reactionTitle: 'skinJournal.notifications.reactionDetected.title',
  reactionBody: 'skinJournal.notifications.reactionDetected.body',
  simplificationTitle: 'skinJournal.notifications.simplificationStarted.title',
  simplificationBody: 'skinJournal.notifications.simplificationStarted.body',
  referralTitle: 'skinJournal.notifications.doctorReferral.title',
  referralBody: 'skinJournal.notifications.doctorReferral.body',
  insightTitle: 'skinJournal.notifications.insightReady.title',
  insightBody: 'skinJournal.notifications.insightReady.body',
  wrappedReadyTitle: 'skinJournal.notifications.wrappedReady.title',
  wrappedReadyBody: 'skinJournal.notifications.wrappedReady.body',
  exportReadyTitle: 'skinJournal.notifications.exportReady.title',
  exportReadyBody: 'skinJournal.notifications.exportReady.body',
} as const;
const EVENT_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'reaction_detected',
  'worsening',
  'recovery',
  'dermatologist_referral',
  'product_effectiveness',
]);
const JOURNAL_DAY_LOCKED_MESSAGE =
  'Journal entries can only be changed on their local day';
const COMPLETE_CHECK_IN_REQUIRED_MESSAGE =
  'Complete check-in fields are required unless skip_check_in is true';
const ANALYSIS_CONCERN_SET: ReadonlySet<AnalysisConcern> =
  new Set<AnalysisConcern>(ANALYSIS_CONCERNS);
const ANALYSIS_CONTEXT_MAX_TEXT_LENGTH = 500;
const ANALYSIS_CONTEXT_MAX_ITEMS = 12;
const CHECK_IN_REQUIRED_FIELDS = {
  overallFeel: 'overall_feel',
  ratings: 'ratings',
  sleepBand: 'sleep_band',
  stressToday: 'stress_today',
  sunExposureToday: 'sun_exposure_today',
  sweatExerciseToday: 'sweat_exercise_today',
  cycleMarker: 'cycle_marker',
} as const;
const VALID_CHECK_IN_RATINGS = new Set<number>([1, 2, 3, 4, 5]);
const PHOTO_UPLOAD_ORDER: Angle[] = [
  SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
  'left_profile',
  'right_profile',
];
const INSIGHT_USEFULNESS_MIN_KIND_SAMPLE = 1;
const INSIGHT_HIGH_DISMISSAL_RATE_THRESHOLD = 0.5;
const INSIGHT_LOW_ACTION_CLICK_RATE_THRESHOLD = 0.05;

type RequiredCheckInField =
  (typeof CHECK_IN_REQUIRED_FIELDS)[keyof typeof CHECK_IN_REQUIRED_FIELDS];

type ParsedPhotoFilter =
  | { kind: 'all'; id: typeof PHOTO_FILTER_ALL_ID }
  | { kind: 'reaction'; id: typeof PHOTO_FILTER_REACTION_ID }
  | { kind: 'concern'; id: string; value: AnalysisConcern };

interface InsightQueryOptions {
  window?: InsightWindow;
  locale?: string;
}

interface InsightGenerationOptions extends InsightQueryOptions {
  trigger: InsightGenerationTrigger;
  expectedInputSignature?: string;
}

interface InsightCadenceSettings {
  cadence: InsightCadence;
  digestDay: number;
  digestLocalTime: string;
  timeZone: string;
}

class InsightInputChangedError extends Error {
  constructor() {
    super('Insight inputs changed while generation was running.');
  }
}

@Injectable()
export class SkinJournalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkinJournalService.name);
  private analysisRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @InjectRepository(SkinJournalEntry)
    private readonly entries: Repository<SkinJournalEntry>,
    @InjectRepository(SkinJournalEntryPhoto)
    private readonly entryPhotos: Repository<SkinJournalEntryPhoto>,
    @InjectRepository(SkinJournalEvent)
    private readonly events: Repository<SkinJournalEvent>,
    @InjectRepository(SkinJournalInsight)
    private readonly insights: Repository<SkinJournalInsight>,
    @InjectRepository(SkinJournalInsightInteraction)
    private readonly insightInteractions: Repository<SkinJournalInsightInteraction>,
    @InjectRepository(ApplicationLog)
    private readonly applicationLogs: Repository<ApplicationLog>,
    @InjectRepository(SkinJournalInsightGenerationRun)
    private readonly insightRuns: Repository<SkinJournalInsightGenerationRun>,
    @InjectRepository(SkinJournalInsightState)
    private readonly insightStates: Repository<SkinJournalInsightState>,
    @InjectRepository(SkinJournalWrapped)
    private readonly wrapped: Repository<SkinJournalWrapped>,
    @InjectRepository(RoutineSimplificationEvent)
    private readonly simplifications: Repository<RoutineSimplificationEvent>,
    @InjectRepository(SkinJournalExportJob)
    private readonly exportJobs: Repository<SkinJournalExportJob>,
    @InjectRepository(UserConsent)
    private readonly consents: Repository<UserConsent>,
    @InjectRepository(SkinProfile)
    private readonly skinProfiles: Repository<SkinProfile>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly photoStorage: SkinJournalPhotoStorageService,
    private readonly analysis: SkinJournalAnalysisService,
    private readonly photoInterpretation: SkinJournalPhotoInterpretationService,
    private readonly analysisQueue: SkinJournalAnalysisQueueService,
    private readonly insightQueue: SkinJournalInsightQueueService,
    private readonly mediaRetention: SkinJournalMediaRetentionService,
    private readonly insightPolish: InsightPolishService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly config: ConfigService,
    private readonly dataAccessLog: UserDataAccessLogService,
    private readonly notifications: NotificationsService,
    @Optional()
    private readonly smartPicksPreparation?: SmartPicksPreparationService,
  ) {}

  onModuleInit(): void {
    void this.recoverInterruptedAnalyses().catch((error) => {
      this.logger.error(
        'Failed to recover interrupted skin journal analyses',
        error,
      );
    });
    this.scheduleAnalysisRecovery();
  }

  onModuleDestroy(): void {
    if (this.analysisRecoveryTimer) {
      clearTimeout(this.analysisRecoveryTimer);
      this.analysisRecoveryTimer = null;
    }
  }

  private scheduleSmartPicksPreparation(userId: string): void {
    this.smartPicksPreparation?.scheduleForUser(userId);
  }

  private normalizePhotoUploads(params: {
    photos?: PhotoUploadMap | null;
  }): PhotoUploadMap {
    return { ...(params.photos ?? {}) };
  }

  private hasPhotoUploads(photos: PhotoUploadMap): boolean {
    return Object.values(photos).some(Boolean);
  }

  private photoRowsByAngle(
    rows: SkinJournalEntryPhoto[],
  ): Map<Angle, SkinJournalEntryPhoto> {
    return new Map(rows.map((photo) => [photo.angle, photo]));
  }

  private sortEntryPhotos(
    rows: SkinJournalEntryPhoto[],
  ): SkinJournalEntryPhoto[] {
    const order = new Map<Angle, number>(
      SKIN_JOURNAL_PHOTO_ANGLES.map((angle, index) => [angle, index]),
    );
    return [...rows].sort(
      (a, b) => (order.get(a.angle) ?? 99) - (order.get(b.angle) ?? 99),
    );
  }

  private frontPhotoRowFromEntrySnapshot(
    entry: SkinJournalEntry,
  ): SkinJournalEntryPhoto | null {
    if (!entry.photo_object_key) {
      return null;
    }
    return this.entryPhotos.create({
      id: entry.id,
      user_id: entry.user_id,
      entry_id: entry.id,
      angle: SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
      photo_object_key: entry.photo_object_key,
      photo_width: entry.photo_width,
      photo_height: entry.photo_height,
      photo_size: entry.photo_size,
      photo_content_type: entry.photo_content_type,
      exif_stripped: entry.exif_stripped,
    });
  }

  private normalizePhotoRowsForEntry(
    entry: SkinJournalEntry,
    rows: SkinJournalEntryPhoto[] = [],
  ): SkinJournalEntryPhoto[] {
    const byAngle = this.photoRowsByAngle(rows);
    const frontSnapshot = this.frontPhotoRowFromEntrySnapshot(entry);
    if (frontSnapshot && !byAngle.has(SKIN_JOURNAL_FRONT_PHOTO_ANGLE)) {
      byAngle.set(SKIN_JOURNAL_FRONT_PHOTO_ANGLE, frontSnapshot);
    }
    return this.sortEntryPhotos(Array.from(byAngle.values()));
  }

  private frontPhotoRow(
    rows: SkinJournalEntryPhoto[],
  ): SkinJournalEntryPhoto | null {
    return (
      rows.find((photo) => photo.angle === SKIN_JOURNAL_FRONT_PHOTO_ANGLE) ??
      null
    );
  }

  private entryWithFrontPhotoCompatibility(
    entry: SkinJournalEntry,
    frontPhoto: SkinJournalEntryPhoto | null,
  ): SkinJournalEntry {
    const compatible = { ...entry };
    compatible.photo_object_key = frontPhoto?.photo_object_key ?? null;
    compatible.photo_width = frontPhoto?.photo_width ?? null;
    compatible.photo_height = frontPhoto?.photo_height ?? null;
    compatible.photo_size = frontPhoto?.photo_size ?? null;
    compatible.photo_content_type = frontPhoto?.photo_content_type ?? null;
    compatible.exif_stripped = frontPhoto?.exif_stripped ?? false;
    compatible.angle = SKIN_JOURNAL_FRONT_PHOTO_ANGLE;
    return compatible as SkinJournalEntry;
  }

  private syncEntryFrontPhotoCompatibility(
    entry: SkinJournalEntry,
    frontPhoto: SkinJournalEntryPhoto | null,
  ): void {
    entry.photo_object_key = frontPhoto?.photo_object_key ?? null;
    entry.photo_width = frontPhoto?.photo_width ?? null;
    entry.photo_height = frontPhoto?.photo_height ?? null;
    entry.photo_size = frontPhoto?.photo_size ?? null;
    entry.photo_content_type = frontPhoto?.photo_content_type ?? null;
    entry.exif_stripped = frontPhoto?.exif_stripped ?? false;
    entry.angle = SKIN_JOURNAL_FRONT_PHOTO_ANGLE;
  }

  private buildEntryResponse(
    entry: SkinJournalEntry,
    rows: SkinJournalEntryPhoto[] = [],
  ): JournalEntryResponseDto {
    const photos = this.normalizePhotoRowsForEntry(entry, rows);
    const front = this.frontPhotoRow(photos);
    const signedPhotos: JournalEntryPhotoResponseDto[] = photos.map(
      (photo) => ({
        angle: photo.angle,
        photo_url: this.photoStorage.getSignedUrl(photo.photo_object_key) ?? '',
        width: photo.photo_width,
        height: photo.photo_height,
      }),
    );
    return JournalEntryResponseDto.fromEntity(
      this.entryWithFrontPhotoCompatibility(entry, front),
      this.photoStorage.getSignedUrl(front?.photo_object_key ?? null),
      signedPhotos,
    );
  }

  private toAnalysisPhotoInputs(
    rows: SkinJournalEntryPhoto[],
  ): AnalysisPhotoInput[] {
    return rows.map((photo) => ({
      angle: photo.angle,
      object_key: photo.photo_object_key,
    }));
  }

  private analysisPhotoInputSignature(photos: AnalysisPhotoInput[]): string {
    return photos
      .map((photo) => `${photo.angle}:${photo.object_key}`)
      .sort()
      .join('|');
  }

  private async loadEntryPhotoRows(
    userId: string,
    entryId: string,
  ): Promise<SkinJournalEntryPhoto[]> {
    return this.sortEntryPhotos(
      await this.entryPhotos.find({
        where: { user_id: userId, entry_id: entryId },
      }),
    );
  }

  private async loadEntryPhotoRowsByEntryId(
    userId: string,
    entryIds: string[],
  ): Promise<EntryPhotoRowsByEntryId> {
    if (entryIds.length === 0) {
      return new Map();
    }
    const rows = await this.entryPhotos.find({
      where: { user_id: userId, entry_id: In(entryIds) },
    });
    const byEntryId: EntryPhotoRowsByEntryId = new Map();
    for (const row of rows) {
      const list = byEntryId.get(row.entry_id) ?? [];
      list.push(row);
      byEntryId.set(row.entry_id, list);
    }
    for (const [entryId, list] of byEntryId) {
      byEntryId.set(entryId, this.sortEntryPhotos(list));
    }
    return byEntryId;
  }

  private async buildEntryResponses(
    userId: string,
    entries: SkinJournalEntry[],
  ): Promise<JournalEntryResponseDto[]> {
    const rowsByEntry = await this.loadEntryPhotoRowsByEntryId(
      userId,
      entries.map((entry) => entry.id),
    );
    return entries.map((entry) =>
      this.buildEntryResponse(entry, rowsByEntry.get(entry.id) ?? []),
    );
  }

  private storedPhotoToRow(
    entry: SkinJournalEntry,
    stored: StoredAnglePhoto,
    existing?: SkinJournalEntryPhoto,
  ): SkinJournalEntryPhoto {
    return this.entryPhotos.create({
      id: existing?.id,
      user_id: entry.user_id,
      entry_id: entry.id,
      angle: stored.angle,
      photo_object_key: stored.object_key,
      photo_width: stored.width,
      photo_height: stored.height,
      photo_size: stored.size,
      photo_content_type: stored.content_type,
      exif_stripped: stored.exif_stripped,
    });
  }

  private photoSetsDiffer(
    previous: Map<Angle, SkinJournalEntryPhoto>,
    next: Map<Angle, SkinJournalEntryPhoto>,
  ): boolean {
    if (previous.size !== next.size) {
      return true;
    }
    for (const angle of SKIN_JOURNAL_PHOTO_ANGLES) {
      const before = previous.get(angle)?.photo_object_key ?? null;
      const after = next.get(angle)?.photo_object_key ?? null;
      if (before !== after) {
        return true;
      }
    }
    return false;
  }

  private clearPhotoAnalysisState(entry: SkinJournalEntry): void {
    entry.analysis_status = AnalysisStatusValue.Pending;
    entry.analysis_observations = null;
    entry.analysis_interpretation = null;
    entry.analysis_concern_keys = [];
    entry.has_reaction_signal = false;
    entry.needs_retake = false;
    entry.analysis_summary = null;
    entry.analysis_model = null;
    entry.analysis_version = null;
    entry.analysis_prompt_version = null;
    entry.analysis_started_at = null;
    entry.analysis_completed_at = null;
    entry.analysis_duration_ms = null;
    entry.analysis_input_image_count = null;
    entry.analysis_input_tokens = null;
    entry.analysis_output_tokens = null;
    entry.analysis_total_tokens = null;
    entry.analysis_estimated_cost_usd = null;
    entry.analysis_error = null;
    entry.analysis_error_code = null;
  }

  async upsertEntryForResolvedDate(params: {
    userId: string;
    targetDate: string;
    timeZone: string;
    photos?: PhotoUploadMap | null;
    body: UpsertEntryDto;
  }): Promise<JournalEntryResponseDto> {
    const body = this.normalizeUpsertBody(params.body);
    const incomingPhotos = this.normalizePhotoUploads(params);
    const hasIncomingPhotos = this.hasPhotoUploads(incomingPhotos);
    const timeZone = resolveSkinJournalTimeZone(params.timeZone);
    const today = todayInTimeZone(timeZone);
    if (!isValidDate(params.targetDate)) {
      throw new BadRequestException('Invalid date');
    }
    if (params.targetDate !== today) {
      throw new BadRequestException(JOURNAL_DAY_LOCKED_MESSAGE);
    }
    await this.assertSkinProfileReadyForJournal(params.userId);

    let entry = await this.entries.findOne({
      where: { user_id: params.userId, entry_date: params.targetDate },
    });

    if (!entry) {
      entry = this.entries.create({
        user_id: params.userId,
        entry_date: params.targetDate,
        time_zone: timeZone,
        analysis_status: AnalysisStatusValue.Pending,
      });
    }

    if (body.concern_focus !== undefined)
      entry.concern_focus = body.concern_focus;
    if (body.is_pre_routine !== undefined)
      entry.is_pre_routine = body.is_pre_routine;

    if (body.skip_check_in !== true) {
      if (body.ratings !== undefined)
        entry.ratings = (body.ratings as RatingsPayload) ?? null;
      if (body.overall_feel !== undefined)
        entry.overall_feel = body.overall_feel;
      if (body.sleep_band !== undefined) entry.sleep_band = body.sleep_band;
      if (body.stress_today !== undefined)
        entry.stress_today = body.stress_today;
      if (body.sun_exposure_today !== undefined)
        entry.sun_exposure_today = body.sun_exposure_today;
      if (body.sweat_exercise_today !== undefined)
        entry.sweat_exercise_today = body.sweat_exercise_today;
      if (body.cycle_marker !== undefined)
        entry.cycle_marker = body.cycle_marker;
      if (body.recent_change !== undefined)
        entry.recent_change = body.recent_change ?? null;
      if (body.complaint_note !== undefined)
        entry.complaint_note = body.complaint_note ?? null;

      this.assertCompleteCheckIn(entry);
    }

    /* Ensure entry has an id before storing the photo so the object key matches. */
    if (!entry.id) {
      entry.id = this.photoStorage.newEntryId();
    }

    const existingRows = this.normalizePhotoRowsForEntry(
      entry,
      await this.loadEntryPhotoRows(params.userId, entry.id),
    );
    const existingByAngle = this.photoRowsByAngle(existingRows);
    const removedAngles = new Set(body.remove_photo_angles ?? []);
    const uploadAngles = PHOTO_UPLOAD_ORDER.filter(
      (angle) => !!incomingPhotos[angle],
    );
    const desiredByAngle = new Map(existingByAngle);
    for (const angle of removedAngles) {
      if (!incomingPhotos[angle]) {
        desiredByAngle.delete(angle);
      }
    }

    if (hasIncomingPhotos) {
      await this.ensureSkinProgressConsent(
        params.userId,
        body.photo_processing_consent === true,
      );
      const headPreserved =
        existingByAngle.has(SKIN_JOURNAL_FRONT_PHOTO_ANGLE) &&
        !removedAngles.has(SKIN_JOURNAL_FRONT_PHOTO_ANGLE);
      const headUploaded = !!incomingPhotos[SKIN_JOURNAL_FRONT_PHOTO_ANGLE];
      const sideUploaded = uploadAngles.some(
        (angle) => angle !== SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
      );
      if (sideUploaded && !headUploaded && !headPreserved) {
        throw new BadRequestException(
          'A front photo is required before adding side photos',
        );
      }
    }

    const newlyStoredPhotos: StoredAnglePhoto[] = [];
    try {
      for (const angle of uploadAngles) {
        const upload = incomingPhotos[angle];
        if (!upload) {
          continue;
        }
        const stored = await this.photoStorage.storePhoto({
          userId: params.userId,
          entryId: entry.id,
          buffer: upload.buffer,
          contentType: upload.contentType,
        });
        const anglePhoto: StoredAnglePhoto = { angle, ...stored };
        newlyStoredPhotos.push(anglePhoto);
        desiredByAngle.set(
          angle,
          this.storedPhotoToRow(entry, anglePhoto, existingByAngle.get(angle)),
        );
      }
    } catch (error) {
      for (const stored of newlyStoredPhotos) {
        await this.deletePhotoBestEffort(
          stored.object_key,
          params.userId,
          'photo_upload_failed_partial_cleanup',
        );
      }
      throw error;
    }

    if (
      desiredByAngle.size > 0 &&
      !desiredByAngle.has(SKIN_JOURNAL_FRONT_PHOTO_ANGLE)
    ) {
      for (const stored of newlyStoredPhotos) {
        await this.deletePhotoBestEffort(
          stored.object_key,
          params.userId,
          'photo_upload_invalid_angle_set_cleanup',
        );
      }
      throw new BadRequestException(
        'A front photo is required when saving skin-progress photos',
      );
    }

    const photoSetChanged = this.photoSetsDiffer(
      existingByAngle,
      desiredByAngle,
    );

    if (photoSetChanged) {
      this.syncEntryFrontPhotoCompatibility(
        entry,
        desiredByAngle.get(SKIN_JOURNAL_FRONT_PHOTO_ANGLE) ?? null,
      );
      this.clearPhotoAnalysisState(entry);
    }

    if (!entry.photo_object_key) {
      entry.analysis_status = AnalysisStatusValue.Skipped;
      entry.analysis_error_code = null;
    }

    let saved: SkinJournalEntry;
    let savedPhotoRows = Array.from(desiredByAngle.values());
    try {
      const savedState = await this.saveEntryAndPhotoSet({
        userId: params.userId,
        entry,
        photoSetChanged,
        existingByAngle,
        desiredByAngle,
      });
      saved = savedState.saved;
      savedPhotoRows = savedState.savedPhotoRows;
    } catch (error) {
      for (const stored of newlyStoredPhotos) {
        await this.deletePhotoBestEffort(
          stored.object_key,
          params.userId,
          'entry_save_failed_after_photo_upload',
        );
      }
      throw error;
    }

    if (photoSetChanged) {
      await this.analysisQueue.cancelActiveJobsForEntry(
        saved.id,
        'Photo set was changed before this analysis job ran.',
      );
      await this.clearEntryAnalysisArtifacts(params.userId, saved.id);
      const desiredObjectKeys = new Set(
        Array.from(desiredByAngle.values()).map(
          (photo) => photo.photo_object_key,
        ),
      );
      const staleObjectKeys = Array.from(
        new Set(
          existingRows
            .filter((photo) => !desiredObjectKeys.has(photo.photo_object_key))
            .map((photo) => photo.photo_object_key),
        ),
      );
      for (const objectKey of staleObjectKeys) {
        await this.deletePhotoBestEffort(
          objectKey,
          params.userId,
          'photo_replaced_or_removed',
        );
      }
    }

    if (
      saved.analysis_status === AnalysisStatusValue.Pending &&
      saved.photo_object_key
    ) {
      await this.tryEnqueueAnalysisForEntry(
        params.userId,
        saved,
        'Analysis queued after photo upload.',
      );
    } else {
      await this.markInsightsAfterJournalChange(
        params.userId,
        'check_in_updated',
      );
    }
    this.scheduleSmartPicksPreparation(params.userId);

    return this.buildEntryResponse(saved, savedPhotoRows);
  }

  private async saveEntryAndPhotoSet(params: {
    userId: string;
    entry: SkinJournalEntry;
    photoSetChanged: boolean;
    existingByAngle: Map<Angle, SkinJournalEntryPhoto>;
    desiredByAngle: Map<Angle, SkinJournalEntryPhoto>;
  }): Promise<{
    saved: SkinJournalEntry;
    savedPhotoRows: SkinJournalEntryPhoto[];
  }> {
    return this.entries.manager.transaction(async (manager: EntityManager) => {
      const entryRepo = manager.getRepository(SkinJournalEntry);
      const entryPhotoRepo = manager.getRepository(SkinJournalEntryPhoto);
      const saved = await entryRepo.save(params.entry);
      let savedPhotoRows = Array.from(params.desiredByAngle.values());
      if (params.photoSetChanged) {
        const anglesToDelete = Array.from(params.existingByAngle.keys()).filter(
          (angle) => !params.desiredByAngle.has(angle),
        );
        if (anglesToDelete.length > 0) {
          await entryPhotoRepo.delete({
            user_id: params.userId,
            entry_id: saved.id,
            angle: In(anglesToDelete),
          });
        }
        savedPhotoRows =
          savedPhotoRows.length > 0
            ? await entryPhotoRepo.save(savedPhotoRows)
            : [];
      }
      return { saved, savedPhotoRows };
    });
  }

  private async deletePhotoBestEffort(
    objectKey: string,
    userId: string | null = null,
    reason = 'journal_media_deleted',
  ): Promise<void> {
    try {
      await this.photoStorage.deletePhoto(objectKey);
    } catch (error) {
      this.logger.warn(
        `Failed to clean up photo ${objectKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
    try {
      await this.mediaRetention.enqueueDeletionVerification({
        userId,
        objectKey,
        reason,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue media deletion verification for ${objectKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async deletePhotoForAccountDeletion(
    objectKey: string,
    userId: string,
  ): Promise<void> {
    await this.photoStorage.deletePhoto(objectKey);

    try {
      await this.mediaRetention.enqueueDeletionVerification({
        userId,
        objectKey,
        reason: 'account_media_deleted',
      });
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue media deletion verification for ${objectKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private assertCompleteCheckIn(entry: SkinJournalEntry): void {
    const missingFields = this.getMissingRequiredCheckInFields(entry);
    if (missingFields.length === 0) {
      return;
    }

    throw new BadRequestException({
      message: COMPLETE_CHECK_IN_REQUIRED_MESSAGE,
      missing_fields: missingFields,
    });
  }

  private getMissingRequiredCheckInFields(
    entry: SkinJournalEntry,
  ): RequiredCheckInField[] {
    const missingFields: RequiredCheckInField[] = [];

    if (!entry.overall_feel) {
      missingFields.push(CHECK_IN_REQUIRED_FIELDS.overallFeel);
    }
    if (!this.hasCompleteRatings(entry.ratings)) {
      missingFields.push(CHECK_IN_REQUIRED_FIELDS.ratings);
    }
    if (!entry.sleep_band) {
      missingFields.push(CHECK_IN_REQUIRED_FIELDS.sleepBand);
    }
    if (!entry.stress_today) {
      missingFields.push(CHECK_IN_REQUIRED_FIELDS.stressToday);
    }
    if (!entry.sun_exposure_today) {
      missingFields.push(CHECK_IN_REQUIRED_FIELDS.sunExposureToday);
    }
    if (
      entry.sweat_exercise_today === null ||
      entry.sweat_exercise_today === undefined
    ) {
      missingFields.push(CHECK_IN_REQUIRED_FIELDS.sweatExerciseToday);
    }
    if (!entry.cycle_marker) {
      missingFields.push(CHECK_IN_REQUIRED_FIELDS.cycleMarker);
    }

    return missingFields;
  }

  private hasCompleteRatings(
    ratings: RatingsPayload | null | undefined,
  ): boolean {
    if (!ratings) {
      return false;
    }

    return CONCERN_KEYS.every((key: ConcernKey) =>
      VALID_CHECK_IN_RATINGS.has(ratings[key] ?? Number.NaN),
    );
  }

  private async assertSkinProfileReadyForJournal(
    userId: string,
  ): Promise<void> {
    const profile = await this.skinProfiles.findOne({
      where: { user_id: userId },
      relations: ['user'],
    });

    if (!profile || !hasCompletedEssentialSkinProfile(profile)) {
      throw skinProfileRequiredException();
    }

    await this.dataAccessLog.recordDataAccess(
      userId,
      getSensitiveSkinProfileConsentTypes(profile),
      UserDataAccessPurpose.SkinProfileRead,
      UserDataAccessActorType.System,
    );
  }

  async retryAnalysis(
    userId: string,
    entryId: string,
  ): Promise<JournalEntryResponseDto> {
    const entry = await this.findOwnedEntry(userId, entryId);
    if (!entry.photo_object_key) {
      throw new BadRequestException('Entry has no photo to analyse');
    }
    entry.analysis_status = AnalysisStatusValue.Pending;
    entry.analysis_error = null;
    entry.analysis_error_code = null;
    entry.analysis_interpretation = null;
    entry.analysis_retry_count = (entry.analysis_retry_count ?? 0) + 1;
    await this.entries.save(entry);
    await this.analysisQueue.cancelActiveJobsForEntry(
      entry.id,
      'Analysis was retried by the user.',
    );
    await this.tryEnqueueAnalysisForEntry(
      userId,
      entry,
      'Analysis queued for retry.',
    );
    const refreshed = await this.entries.findOneByOrFail({ id: entry.id });
    return this.buildEntryResponse(
      refreshed,
      await this.loadEntryPhotoRows(userId, refreshed.id),
    );
  }

  async getToday(
    userId: string,
    timeZone: string,
  ): Promise<{
    date: string;
    entry: JournalEntryResponseDto | null;
  }> {
    const date = todayInTimeZone(timeZone);
    const entry = await this.entries.findOne({
      where: { user_id: userId, entry_date: date },
    });
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    return {
      date,
      entry: entry
        ? this.buildEntryResponse(
            entry,
            await this.loadEntryPhotoRows(userId, entry.id),
          )
        : null,
    };
  }

  async readSignedLocalMedia(token: string): Promise<{
    buffer: Buffer;
    contentType: string;
    maxAgeSeconds: number;
  }> {
    return this.photoStorage.readSignedLocalPhotoToken(token);
  }

  async getDay(userId: string, date: string): Promise<DayDetailResponseDto> {
    if (!isValidDate(date)) {
      throw new BadRequestException('Invalid date');
    }
    const entry = await this.entries.findOne({
      where: { user_id: userId, entry_date: date },
    });

    let entryDto: JournalEntryResponseDto | null = null;
    let events: SkinJournalEvent[] = [];
    let insights: SkinJournalInsight[] = [];

    if (entry) {
      entryDto = this.buildEntryResponse(
        entry,
        await this.loadEntryPhotoRows(userId, entry.id),
      );
      events = await this.events.find({
        where: { user_id: userId, entry_id: entry.id },
        order: { created_at: 'DESC' },
      });
      insights = await this.insights.find({
        where: { user_id: userId, dismissed_at: IsNull() },
        order: { generated_at: 'DESC' },
      });
      insights = insights.filter(
        (i) =>
          !i.source_entry_ids ||
          i.source_entry_ids.length === 0 ||
          i.source_entry_ids.includes(entry.id),
      );
    }

    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    return {
      date,
      entry: entryDto,
      events: events.map((e) => JournalEventResponseDto.fromEntity(e)),
      insights: insights.map((i) => JournalInsightResponseDto.fromEntity(i)),
    };
  }

  async getCalendar(
    userId: string,
    month: string,
  ): Promise<CalendarResponseDto> {
    const { start, end } = monthRange(month);
    const entries = await this.entries.find({
      where: {
        user_id: userId,
        entry_date: Between(start, end),
      },
    });
    const insights = await this.insights.find({
      where: { user_id: userId, dismissed_at: IsNull() },
    });
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    const dates = listDatesInRange(start, end);
    const byDate = new Map(entries.map((e) => [e.entry_date, e]));
    const insightEntryIds = new Set<string>();
    for (const i of insights) {
      for (const id of i.source_entry_ids ?? []) {
        insightEntryIds.add(id);
      }
    }

    const days: CalendarDayDto[] = dates.map((date) => {
      const entry = byDate.get(date);
      let state: CalendarDayState = CalendarDayStateValue.NoEntry;
      let hasReaction = false;
      if (entry) {
        if (!entry.photo_object_key) {
          state = CalendarDayStateValue.EntryNoPhoto;
        } else if (
          entry.analysis_status === AnalysisStatusValue.Pending ||
          entry.analysis_status === AnalysisStatusValue.Queued ||
          entry.analysis_status === AnalysisStatusValue.Running
        ) {
          state = CalendarDayStateValue.Pending;
        } else if (entry.analysis_status === AnalysisStatusValue.Failed) {
          state = CalendarDayStateValue.Failed;
        } else {
          hasReaction = entry.has_reaction_signal;
          state = hasReaction
            ? CalendarDayStateValue.Reaction
            : CalendarDayStateValue.Completed;
        }
      }
      return {
        date,
        state,
        entry_id: entry?.id ?? null,
        has_photo: !!entry?.photo_object_key,
        has_reaction: hasReaction,
        has_insight: entry ? insightEntryIds.has(entry.id) : false,
        thumbnail_url: this.photoStorage.getSignedUrl(
          entry?.photo_object_key ?? null,
        ),
        analysis_status: entry?.analysis_status ?? null,
      };
    });

    return { month, days };
  }

  async getMonthEntries(
    userId: string,
    month: string,
  ): Promise<JournalEntryResponseDto[]> {
    const { start, end } = monthRange(month);
    const entries = await this.entries.find({
      where: { user_id: userId, entry_date: Between(start, end) },
      order: { entry_date: 'DESC' },
    });
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    return this.buildEntryResponses(userId, entries);
  }

  async listPhotos(
    userId: string,
    filters: {
      from?: string;
      to?: string;
      filter?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<PhotoPageResponseDto> {
    this.validateOptionalDateRange(filters);
    const parsedFilter = this.parsePhotoFilter(filters.filter);
    const take = clampInteger(
      filters.limit ?? SKIN_JOURNAL_PHOTO_PAGE_DEFAULT_LIMIT,
      1,
      SKIN_JOURNAL_PHOTO_PAGE_MAX_LIMIT,
    );
    const fingerprint = photoCursorFingerprint(userId, filters, parsedFilter);
    const queryBuilder = this.entries
      .createQueryBuilder('entry')
      .where('entry.user_id = :userId', { userId })
      .andWhere('entry.photo_object_key IS NOT NULL')
      .orderBy('entry.entry_date', 'DESC')
      .addOrderBy('entry.id', 'DESC');

    this.applyPhotoDateFilters(queryBuilder, filters);
    this.applyPhotoFilter(queryBuilder, parsedFilter);
    this.applyPhotoCursor(queryBuilder, filters.cursor, fingerprint);

    const rows = await queryBuilder.take(take + 1).getMany();
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: await this.buildEntryResponses(userId, page),
      nextCursor: this.buildPhotoNextCursor(page.at(-1), fingerprint, hasMore),
    };
  }

  async listPhotoFilters(
    userId: string,
    filters: { from?: string; to?: string },
  ): Promise<PhotoFiltersResponseDto> {
    this.validateOptionalDateRange(filters);
    const list = await this.entries.find({
      where: this.buildPhotoEntryWhere(userId, filters),
      order: { entry_date: 'DESC' },
    });
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);

    const concernCounts = new Map<AnalysisConcern, number>();
    let reactionCount = 0;
    for (const entry of list) {
      if (entry.has_reaction_signal) {
        reactionCount += 1;
      }
      const entryConcerns = new Set<AnalysisConcern>();
      for (const concern of entry.analysis_concern_keys ?? []) {
        if (ANALYSIS_CONCERN_SET.has(concern)) {
          entryConcerns.add(concern);
        }
      }
      for (const concern of entryConcerns) {
        concernCounts.set(concern, (concernCounts.get(concern) ?? 0) + 1);
      }
    }

    const photoFilters: PhotoFilterOptionDto[] = [
      {
        id: PHOTO_FILTER_ALL_ID,
        kind: 'all',
        value: null,
        count: list.length,
      },
    ];
    if (reactionCount > 0) {
      photoFilters.push({
        id: PHOTO_FILTER_REACTION_ID,
        kind: 'reaction',
        value: null,
        count: reactionCount,
      });
    }
    for (const concern of ANALYSIS_CONCERNS) {
      const count = concernCounts.get(concern) ?? 0;
      if (count > 0) {
        photoFilters.push({
          id: `${PHOTO_FILTER_CONCERN_PREFIX}${concern}`,
          kind: 'concern',
          value: concern,
          count,
        });
      }
    }

    return {
      filters: photoFilters,
    };
  }

  async listPhotoDates(
    userId: string,
    filters: { from?: string; to?: string },
  ): Promise<PhotoDatesResponseDto> {
    if (filters.from && !isValidDate(filters.from)) {
      throw new BadRequestException('Invalid from date');
    }
    if (filters.to && !isValidDate(filters.to)) {
      throw new BadRequestException('Invalid to date');
    }
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new BadRequestException('Date range must start before it ends');
    }

    const where: FindOptionsWhere<SkinJournalEntry> = {
      user_id: userId,
      photo_object_key: Not(IsNull()),
    };
    if (filters.from && filters.to) {
      where.entry_date = Between(filters.from, filters.to);
    } else if (filters.from) {
      where.entry_date = MoreThanOrEqual(filters.from);
    } else if (filters.to) {
      where.entry_date = LessThanOrEqual(filters.to);
    }

    const entries = await this.entries.find({
      where,
      order: { entry_date: 'DESC' },
    });
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);

    const monthCounts = new Map<string, number>();
    const dates = entries.map((entry) => {
      const month = entry.entry_date.slice(0, 7);
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
      return {
        date: entry.entry_date,
        entry_id: entry.id,
        analysis_status: entry.analysis_status,
        has_reaction: entry.has_reaction_signal,
      };
    });

    return {
      dates,
      months: Array.from(monthCounts.entries()).map(([month, photo_count]) => ({
        month,
        photo_count,
      })),
    };
  }

  async getCompare(
    userId: string,
    fromDate: string,
    toDate: string,
  ): Promise<{
    from: JournalEntryResponseDto | null;
    to: JournalEntryResponseDto | null;
    delta: {
      bullets: CompareDeltaBullet[];
    };
  }> {
    if (!isValidDate(fromDate) || !isValidDate(toDate)) {
      throw new BadRequestException('Invalid date');
    }
    if (fromDate === toDate) {
      throw new BadRequestException('Compare dates must be different');
    }
    const [from, to] = await Promise.all([
      this.entries.findOne({
        where: { user_id: userId, entry_date: fromDate },
      }),
      this.entries.findOne({
        where: { user_id: userId, entry_date: toDate },
      }),
    ]);
    if (!from?.photo_object_key || !to?.photo_object_key) {
      throw new BadRequestException(
        'Both compare dates must have uploaded photos',
      );
    }
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    const rowsByEntry = await this.loadEntryPhotoRowsByEntryId(userId, [
      from.id,
      to.id,
    ]);
    return {
      from: this.buildEntryResponse(from, rowsByEntry.get(from.id) ?? []),
      to: this.buildEntryResponse(to, rowsByEntry.get(to.id) ?? []),
      delta: this.computeDelta(from, to),
    };
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const entry = await this.findOwnedEntry(userId, entryId);
    this.assertEntryIsEditableToday(entry);
    const photoRows = this.normalizePhotoRowsForEntry(
      entry,
      await this.loadEntryPhotoRows(userId, entry.id),
    );
    const objectKeys = Array.from(
      new Set(
        photoRows
          .map((photo) => photo.photo_object_key)
          .filter((key): key is string => typeof key === 'string' && !!key),
      ),
    );
    await this.analysisQueue.cancelActiveJobsForEntry(
      entry.id,
      'Journal entry was deleted.',
    );
    await this.entries.delete({ id: entry.id });
    await this.clearEntryAnalysisArtifacts(userId, entry.id);
    for (const objectKey of objectKeys) {
      await this.deletePhotoBestEffort(objectKey, userId, 'entry_deleted');
    }
    await this.markInsightsAfterJournalChange(userId, 'entry_deleted');
    this.scheduleSmartPicksPreparation(userId);
  }

  async updateEntryById(
    userId: string,
    entryId: string,
    body: UpsertEntryDto,
  ): Promise<JournalEntryResponseDto> {
    const entry = await this.findOwnedEntry(userId, entryId);
    this.assertEntryIsEditableToday(entry);
    return this.upsertEntryForResolvedDate({
      userId,
      targetDate: entry.entry_date,
      timeZone: entry.time_zone,
      body,
    });
  }

  async processAnalysisJob(job: SkinJournalAnalysisJob): Promise<void> {
    const entry = await this.entries.findOne({
      where: { id: job.entry_id, user_id: job.user_id },
    });
    if (!entry || !entry.photo_object_key) {
      await this.analysisQueue.cancelJob(
        job,
        'Journal entry or photo no longer exists.',
      );
      return;
    }
    if (entry.photo_object_key !== job.photo_object_key) {
      await this.analysisQueue.cancelJob(
        job,
        'Photo was replaced before this analysis job ran.',
      );
      return;
    }

    await this.runAnalysis(
      job.entry_id,
      job.user_id,
      job.photo_object_key,
      job,
    );
  }

  async runAnalysis(
    entryId: string,
    userId: string,
    expectedPhotoObjectKey?: string,
    job?: SkinJournalAnalysisJob,
  ): Promise<void> {
    const entry = await this.entries.findOne({
      where: { id: entryId, user_id: userId },
    });
    if (!entry || !entry.photo_object_key) {
      if (job) {
        await this.analysisQueue.cancelJob(
          job,
          'Journal entry or photo no longer exists.',
        );
      }
      return;
    }

    const currentPhotoRows = this.normalizePhotoRowsForEntry(
      entry,
      await this.loadEntryPhotoRows(userId, entry.id),
    );
    const frontPhoto = this.frontPhotoRow(currentPhotoRows);
    if (!frontPhoto) {
      if (job) {
        await this.analysisQueue.cancelJob(
          job,
          'Journal entry or photo no longer exists.',
        );
      }
      return;
    }
    const photoObjectKey =
      expectedPhotoObjectKey ?? frontPhoto.photo_object_key;
    if (frontPhoto.photo_object_key !== photoObjectKey) {
      if (job) {
        await this.analysisQueue.cancelJob(
          job,
          'Photo was replaced before this analysis job ran.',
        );
      }
      return;
    }
    const currentPhotos = this.toAnalysisPhotoInputs(currentPhotoRows);
    const expectedPhotoSignature =
      this.analysisPhotoInputSignature(currentPhotos);
    const startedAt = nowDate();
    const fallbackStartedAt = Date.now();
    let plannedInputImageCount = currentPhotos.length;
    try {
      entry.analysis_status = AnalysisStatusValue.Running;
      entry.analysis_started_at = startedAt;
      await this.entries.save(entry);
      await this.recordDataAccess(
        userId,
        UserDataAccessPurpose.SkinPhotoAnalysis,
        UserDataAccessActorType.System,
      );
      const [previousEntry, skinProfile] = await Promise.all([
        this.findPreviousPhotoEntry(userId, entry),
        this.skinProfiles.findOne({ where: { user_id: userId } }),
      ]);
      const skinContext = this.buildAnalysisSkinContext(skinProfile);
      const comparisonReference = previousEntry
        ? buildAnalysisComparisonReference(previousEntry)
        : null;
      plannedInputImageCount =
        currentPhotos.length + (previousEntry?.photo_object_key ? 1 : 0);
      const result = await this.analysis.analyze({
        userId,
        entryId: entry.id,
        photoObjectKey,
        photos: currentPhotos,
        priorPhotoObjectKey: previousEntry?.photo_object_key ?? null,
        concernFocus: entry.concern_focus,
        priorAnalysis: previousEntry?.analysis_observations ?? null,
        skinContext,
        entryContext: this.buildAnalysisEntryContext(entry),
      });
      const obs = withAnalysisComparisonReference(
        result.observations,
        comparisonReference,
      );

      const current = await this.entries.findOne({
        where: { id: entryId, user_id: userId },
      });
      const latestPhotoRows = current
        ? this.normalizePhotoRowsForEntry(
            current,
            await this.loadEntryPhotoRows(userId, current.id),
          )
        : [];
      const latestFrontPhoto = this.frontPhotoRow(latestPhotoRows);
      const latestPhotoSignature = this.analysisPhotoInputSignature(
        this.toAnalysisPhotoInputs(latestPhotoRows),
      );
      if (
        !current ||
        latestFrontPhoto?.photo_object_key !== photoObjectKey ||
        latestPhotoSignature !== expectedPhotoSignature
      ) {
        if (job) {
          await this.analysisQueue.cancelJob(
            job,
            'Photo set was replaced before completed analysis could be saved.',
          );
        }
        return;
      }

      const interpretation = this.photoInterpretation.interpret(
        obs,
        new Date(),
        {
          skinContext,
          recentChange: current.recent_change,
        },
      );
      current.analysis_observations = obs;
      current.analysis_interpretation = interpretation;
      current.analysis_concern_keys = this.analysisConcernKeys(obs);
      current.has_reaction_signal = obs.reaction_signals.reaction_detected;
      current.needs_retake =
        !obs.image_quality.face_detected ||
        obs.image_quality.needs_retake === true;
      current.analysis_summary = interpretation.summary_key;
      current.analysis_status =
        obs.image_quality.face_detected &&
        obs.image_quality.needs_retake !== true
          ? AnalysisStatusValue.Completed
          : AnalysisStatusValue.NeedsReview;
      current.analysis_model = obs.model_version;
      current.analysis_version = obs.schema_version;
      current.analysis_prompt_version = result.metadata.prompt_version;
      current.analysis_started_at = startedAt;
      current.analysis_duration_ms = result.metadata.duration_ms;
      current.analysis_input_image_count = result.metadata.input_image_count;
      current.analysis_input_tokens = result.metadata.input_tokens;
      current.analysis_output_tokens = result.metadata.output_tokens;
      current.analysis_total_tokens = result.metadata.total_tokens;
      current.analysis_estimated_cost_usd = result.metadata.estimated_cost_usd;
      current.analysis_completed_at = new Date();
      current.analysis_error = null;
      current.analysis_error_code = null;
      await this.entries.save(current);
      this.scheduleSmartPicksPreparation(userId);

      await this.evaluateCompletedAnalysis(userId, current, obs);
      if (job) {
        await this.analysisQueue.completeJob(job);
      }
    } catch (err) {
      const current = await this.entries.findOne({
        where: { id: entryId, user_id: userId },
      });
      const latestPhotoRows = current
        ? this.normalizePhotoRowsForEntry(
            current,
            await this.loadEntryPhotoRows(userId, current.id),
          )
        : [];
      const latestFrontPhoto = this.frontPhotoRow(latestPhotoRows);
      const latestPhotoSignature = this.analysisPhotoInputSignature(
        this.toAnalysisPhotoInputs(latestPhotoRows),
      );
      if (
        !current ||
        latestFrontPhoto?.photo_object_key !== photoObjectKey ||
        latestPhotoSignature !== expectedPhotoSignature
      ) {
        if (job) {
          await this.analysisQueue.cancelJob(
            job,
            'Photo set was replaced before failed analysis could be recorded.',
          );
        }
        return;
      }
      const failure = classifyAnalysisFailure(err);
      const errorMessage = failure.message;
      const shouldRetry =
        !!job &&
        failure.retryable &&
        job.attempt_count <
          (job.max_attempts || this.analysisQueue.getMaxAttempts());
      if (shouldRetry && job) {
        current.analysis_status = AnalysisStatusValue.Queued;
        current.analysis_error = errorMessage;
        current.analysis_error_code = failure.code;
        current.analysis_prompt_version = this.analysis.promptVersion();
        current.analysis_started_at = startedAt;
        current.analysis_duration_ms = Date.now() - fallbackStartedAt;
        current.analysis_input_image_count = plannedInputImageCount;
        await this.entries.save(current);
        await this.analysisQueue.rescheduleJob(job, {
          reason: errorMessage,
          runAfter: this.analysisQueue.nextRetryAt(job.attempt_count),
        });
        return;
      }

      current.analysis_status = AnalysisStatusValue.Failed;
      current.analysis_error = errorMessage;
      current.analysis_error_code = failure.code;
      current.analysis_prompt_version = this.analysis.promptVersion();
      current.analysis_started_at = startedAt;
      current.analysis_duration_ms = Date.now() - fallbackStartedAt;
      current.analysis_input_image_count = plannedInputImageCount;
      await this.entries.save(current);
      this.scheduleSmartPicksPreparation(userId);
      if (job) {
        await this.analysisQueue.failJob(job, errorMessage);
      }
      await this.dispatchNotification({
        userId,
        kind: 'analysis_failed',
        titleKey: NOTIFICATION_KEYS.analysisFailedTitle,
        bodyKey: NOTIFICATION_KEYS.analysisFailedBody,
        severity: 'warning',
        payload: { entry_id: entryId, entry_date: current.entry_date },
        deepLink: `/journal/days/${current.entry_date}`,
      });
    }
  }

  private async markAnalysisQueued(
    userId: string,
    entryId: string,
    photoObjectKey: string,
    reason: string,
  ): Promise<void> {
    const current = await this.entries.findOne({
      where: { id: entryId, user_id: userId },
    });
    if (!current || current.photo_object_key !== photoObjectKey) {
      return;
    }
    if (current.analysis_status === AnalysisStatusValue.Completed) {
      return;
    }
    current.analysis_status = AnalysisStatusValue.Queued;
    current.analysis_error = reason;
    current.analysis_error_code = null;
    await this.entries.save(current);
  }

  private async enqueueAnalysisForEntry(
    userId: string,
    entry: SkinJournalEntry,
    reason: string,
    runAfter = new Date(),
  ): Promise<void> {
    if (!entry.photo_object_key) {
      return;
    }
    await this.markAnalysisQueued(
      userId,
      entry.id,
      entry.photo_object_key,
      reason,
    );
    await this.analysisQueue.enqueueAnalysisJob({
      userId,
      entryId: entry.id,
      photoObjectKey: entry.photo_object_key,
      reason,
      runAfter,
    });
  }

  private async tryEnqueueAnalysisForEntry(
    userId: string,
    entry: SkinJournalEntry,
    reason: string,
    runAfter = new Date(),
  ): Promise<void> {
    try {
      await this.enqueueAnalysisForEntry(userId, entry, reason, runAfter);
    } catch (error) {
      this.logger.error(
        `Failed to create durable analysis job for ${entry.id}; recovery will retry.`,
        error,
      );
      if (entry.photo_object_key) {
        entry.analysis_status = AnalysisStatusValue.Queued;
        entry.analysis_error =
          'Analysis queue is temporarily unavailable; it will retry automatically.';
        entry.analysis_error_code = null;
        await this.entries.save(entry);
      }
    }
  }

  private async rescheduleAnalysisJob(
    userId: string,
    entryId: string,
    photoObjectKey: string,
    job: SkinJournalAnalysisJob | undefined,
    reason: string,
    runAfter: Date,
  ): Promise<void> {
    await this.markAnalysisQueued(userId, entryId, photoObjectKey, reason);
    if (job) {
      await this.analysisQueue.rescheduleJob(job, { reason, runAfter });
      return;
    }
    await this.analysisQueue.enqueueAnalysisJob({
      userId,
      entryId,
      photoObjectKey,
      reason,
      runAfter,
    });
  }

  async recoverInterruptedAnalyses(): Promise<void> {
    if (!(await this.analysisQueue.isReady())) {
      return;
    }
    await this.analysisQueue.recoverExpiredLocks();
    const recoverableStatuses: AnalysisStatus[] = [
      AnalysisStatusValue.Pending,
      AnalysisStatusValue.Queued,
      AnalysisStatusValue.Running,
    ];
    const interrupted = await this.entries.find({
      where: {
        analysis_status: In(recoverableStatuses),
        photo_object_key: Not(IsNull()),
      } as FindOptionsWhere<SkinJournalEntry>,
      take: 100,
    });

    for (const entry of interrupted) {
      if (!entry.photo_object_key) {
        continue;
      }
      entry.analysis_status = AnalysisStatusValue.Queued;
      entry.analysis_error =
        'Analysis queued after service restart; it will retry automatically.';
      entry.analysis_error_code = null;
      await this.entries.save(entry);
      await this.analysisQueue.enqueueAnalysisJob({
        userId: entry.user_id,
        entryId: entry.id,
        photoObjectKey: entry.photo_object_key,
        reason: entry.analysis_error,
        runAfter: new Date(
          Date.now() + SKIN_JOURNAL_ANALYSIS_CAPACITY_RETRY_DELAY_MS,
        ),
      });
    }
  }

  async getAnalysisQueueMetrics(): Promise<AnalysisQueueMetrics> {
    return this.analysisQueue.getQueueMetrics();
  }

  async getAnalysisQueueOperations(token: string | undefined): Promise<{
    queue: AnalysisQueueMetrics;
    analysis: AnalysisOperationsMetrics;
    alerts: Array<{
      code: string;
      severity: 'warning' | 'critical';
      value: number;
      threshold: number;
    }>;
  }> {
    this.assertOperationsToken(token);
    const queue = await this.analysisQueue.getQueueMetrics();
    const windowHours = 24;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const analysedEntries = await this.entries.find({
      where: {
        analysis_started_at: MoreThanOrEqual(since),
      } as FindOptionsWhere<SkinJournalEntry>,
      take: 500,
    });
    const completedCount = analysedEntries.filter(
      (entry) => entry.analysis_status === AnalysisStatusValue.Completed,
    ).length;
    const failedCount = analysedEntries.filter(
      (entry) => entry.analysis_status === AnalysisStatusValue.Failed,
    ).length;
    const needsReviewCount = analysedEntries.filter(
      (entry) => entry.analysis_status === AnalysisStatusValue.NeedsReview,
    ).length;
    const durationValues = analysedEntries
      .map((entry) => entry.analysis_duration_ms)
      .filter((value): value is number => typeof value === 'number');
    const averageDuration =
      durationValues.length > 0
        ? Math.round(
            durationValues.reduce((sum, value) => sum + value, 0) /
              durationValues.length,
          )
        : null;
    const inputImageCountValues = analysedEntries
      .map((entry) => entry.analysis_input_image_count)
      .filter((value): value is number => typeof value === 'number');
    const averageInputImageCount =
      inputImageCountValues.length > 0
        ? Number(
            (
              inputImageCountValues.reduce((sum, value) => sum + value, 0) /
              inputImageCountValues.length
            ).toFixed(2),
          )
        : null;
    const denominator = Math.max(1, analysedEntries.length);
    const multiAngleCount = analysedEntries.filter(
      (entry) => (entry.analysis_input_image_count ?? 0) > 1,
    ).length;
    const retakeCount = analysedEntries.filter(
      (entry) =>
        entry.needs_retake ||
        entry.analysis_observations?.image_quality?.needs_retake,
    ).length;
    const safetyFlagCount = analysedEntries.filter(
      (entry) =>
        entry.analysis_observations?.safety_flags?.urgent_review_recommended ||
        entry.analysis_observations?.safety_flags?.doctor_follow_up_recommended,
    ).length;
    const estimatedCost = analysedEntries.reduce(
      (sum, entry) => sum + (entry.analysis_estimated_cost_usd ?? 0),
      0,
    );
    const totalTokens = analysedEntries.reduce(
      (sum, entry) => sum + (entry.analysis_total_tokens ?? 0),
      0,
    );
    const failureCodes = this.buildFailureCodeCounts(analysedEntries);
    const photoPreflight =
      this.buildPhotoPreflightOperationsMetrics(analysedEntries);
    const perAngleQuality =
      this.buildPerAngleQualityOperationsMetrics(analysedEntries);
    const concernCounts = this.buildConcernCounts(analysedEntries);
    const failureRate = failedCount / denominator;
    const alerts: Array<{
      code: string;
      severity: 'warning' | 'critical';
      value: number;
      threshold: number;
    }> = [];
    if (
      queue.oldest_queued_age_seconds !== null &&
      queue.oldest_queued_age_seconds >
        SKIN_JOURNAL_ANALYSIS_QUEUE_AGE_ALERT_SECONDS
    ) {
      alerts.push({
        code: 'analysis_queue_oldest_job_age_high',
        severity: 'critical',
        value: queue.oldest_queued_age_seconds,
        threshold: SKIN_JOURNAL_ANALYSIS_QUEUE_AGE_ALERT_SECONDS,
      });
    }
    if (failureRate > SKIN_JOURNAL_ANALYSIS_FAILURE_RATE_ALERT_THRESHOLD) {
      alerts.push({
        code: 'analysis_failure_rate_high',
        severity: 'warning',
        value: failureRate,
        threshold: SKIN_JOURNAL_ANALYSIS_FAILURE_RATE_ALERT_THRESHOLD,
      });
    }
    if ((queue.dlq_visible_count ?? 0) > 0) {
      alerts.push({
        code: 'analysis_dlq_not_empty',
        severity: 'critical',
        value: queue.dlq_visible_count ?? 0,
        threshold: 0,
      });
    }
    if (
      photoPreflight.local_face_rejection_rate >=
      SKIN_JOURNAL_LOCAL_FACE_REJECTION_RATE_ML_REVIEW_THRESHOLD
    ) {
      alerts.push({
        code: 'local_face_rejection_rate_high',
        severity: 'warning',
        value: photoPreflight.local_face_rejection_rate,
        threshold: SKIN_JOURNAL_LOCAL_FACE_REJECTION_RATE_ML_REVIEW_THRESHOLD,
      });
    }
    if (
      photoPreflight.ai_no_face_rate >=
      SKIN_JOURNAL_AI_NO_FACE_RATE_ML_REVIEW_THRESHOLD
    ) {
      alerts.push({
        code: 'ai_no_face_rate_high',
        severity: 'warning',
        value: photoPreflight.ai_no_face_rate,
        threshold: SKIN_JOURNAL_AI_NO_FACE_RATE_ML_REVIEW_THRESHOLD,
      });
    }

    return {
      queue,
      analysis: {
        window_hours: windowHours,
        completed_count: completedCount,
        failed_count: failedCount,
        needs_review_count: needsReviewCount,
        average_duration_ms: averageDuration,
        average_input_image_count: averageInputImageCount,
        multi_angle_rate: multiAngleCount / denominator,
        failure_rate: failureRate,
        retake_rate: retakeCount / denominator,
        safety_flag_rate: safetyFlagCount / denominator,
        estimated_cost_usd: estimatedCost,
        total_tokens: totalTokens,
        failure_codes: failureCodes,
        photo_preflight: photoPreflight,
        per_angle_quality: perAngleQuality,
        concern_counts: concernCounts,
      },
      alerts,
    };
  }

  async getInsightOperations(token: string | undefined): Promise<{
    usefulness: InsightUsefulnessOperationsMetrics;
    alerts: Array<{
      code: string;
      severity: 'warning';
      value: number;
      threshold: number;
    }>;
  }> {
    this.assertOperationsToken(token);
    const windowHours = 24 * 30;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const [recentInsights, recentInteractions] = await Promise.all([
      this.insights.find({
        where: {
          generated_at: MoreThanOrEqual(since),
        } as FindOptionsWhere<SkinJournalInsight>,
        take: 1000,
      }),
      this.insightInteractions.find({
        where: {
          created_at: MoreThanOrEqual(since),
        } as FindOptionsWhere<SkinJournalInsightInteraction>,
        take: 5000,
      }),
    ]);
    const usefulness = this.buildInsightUsefulnessMetrics(
      recentInsights,
      recentInteractions,
      windowHours,
    );
    const alerts = usefulness.evaluation_case_hints.map((hint) => ({
      code:
        hint.reason === 'high_dismissal_rate'
          ? 'insight_kind_dismissal_rate_high'
          : 'insight_kind_action_click_rate_low',
      severity: 'warning' as const,
      value: hint.value,
      threshold: hint.threshold,
    }));

    return { usefulness, alerts };
  }

  private buildInsightUsefulnessMetrics(
    insights: SkinJournalInsight[],
    interactions: SkinJournalInsightInteraction[],
    windowHours: number,
  ): InsightUsefulnessOperationsMetrics {
    const actionInsightIds = new Set(
      interactions
        .filter(
          (interaction) =>
            interaction.interaction_type ===
            InsightInteractionTypeValue.ActionClicked,
        )
        .map((interaction) => interaction.insight_id),
    );
    const metricsFor = (
      source: SkinJournalInsight[],
    ): InsightUsefulnessKindMetric => {
      const generatedCount = source.length;
      const denominator = Math.max(1, generatedCount);
      const seenCount = source.filter((insight) => insight.seen_at).length;
      const dismissedCount = source.filter(
        (insight) => insight.dismissed_at,
      ).length;
      const actionClickCount = source.filter((insight) =>
        actionInsightIds.has(insight.id),
      ).length;
      return {
        generated_count: generatedCount,
        seen_count: seenCount,
        dismissed_count: dismissedCount,
        action_click_count: actionClickCount,
        seen_rate: seenCount / denominator,
        dismissed_rate: dismissedCount / denominator,
        action_click_rate: actionClickCount / denominator,
      };
    };
    const byKind: Partial<Record<InsightKind, InsightUsefulnessKindMetric>> =
      {};
    for (const kind of new Set(insights.map((insight) => insight.kind))) {
      byKind[kind] = metricsFor(
        insights.filter((insight) => insight.kind === kind),
      );
    }
    return {
      window_hours: windowHours,
      ...metricsFor(insights),
      by_kind: byKind,
      evaluation_case_hints: this.buildInsightEvaluationCaseHints(byKind),
    };
  }

  private buildInsightEvaluationCaseHints(
    byKind: Partial<Record<InsightKind, InsightUsefulnessKindMetric>>,
  ): InsightEvaluationCaseHint[] {
    const hints: InsightEvaluationCaseHint[] = [];
    for (const [kind, metrics] of Object.entries(byKind) as Array<
      [InsightKind, InsightUsefulnessKindMetric]
    >) {
      if (metrics.generated_count < INSIGHT_USEFULNESS_MIN_KIND_SAMPLE) {
        continue;
      }
      if (
        metrics.dismissed_rate >= INSIGHT_HIGH_DISMISSAL_RATE_THRESHOLD &&
        metrics.dismissed_count > 0
      ) {
        hints.push({
          insight_kind: kind,
          reason: 'high_dismissal_rate',
          value: metrics.dismissed_rate,
          threshold: INSIGHT_HIGH_DISMISSAL_RATE_THRESHOLD,
        });
        continue;
      }
      if (
        metrics.seen_count >= INSIGHT_USEFULNESS_MIN_KIND_SAMPLE &&
        metrics.action_click_rate <= INSIGHT_LOW_ACTION_CLICK_RATE_THRESHOLD
      ) {
        hints.push({
          insight_kind: kind,
          reason: 'low_action_click_rate',
          value: metrics.action_click_rate,
          threshold: INSIGHT_LOW_ACTION_CLICK_RATE_THRESHOLD,
        });
      }
    }
    return hints;
  }

  private buildFailureCodeCounts(
    entries: SkinJournalEntry[],
  ): Partial<Record<AnalysisFailureCode, number>> {
    const counts: Partial<Record<AnalysisFailureCode, number>> = {};
    for (const entry of entries) {
      const code = entry.analysis_error_code;
      if (code) {
        counts[code] = (counts[code] ?? 0) + 1;
      }
    }
    return counts;
  }

  private buildPhotoPreflightOperationsMetrics(
    entries: SkinJournalEntry[],
  ): PhotoPreflightOperationsMetrics {
    const issueCounts: Partial<Record<AnalysisPhotoPreflightIssue, number>> =
      {};
    let rejectedCount = 0;
    let localFaceRejectedCount = 0;
    let completedWithAnalysisCount = 0;
    let aiNoFaceCount = 0;

    for (const entry of entries) {
      if (
        entry.analysis_error_code ===
        AnalysisFailureCodeValue.PhotoPreflightRejected
      ) {
        rejectedCount += 1;
        const issues = parseAnalysisPhotoPreflightIssues(entry.analysis_error);
        for (const issue of issues) {
          issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
        }
      }

      if (entry.analysis_observations) {
        completedWithAnalysisCount += 1;
        if (hasAiNoFaceSignal(entry.analysis_observations)) {
          aiNoFaceCount += 1;
        }
      }
    }

    localFaceRejectedCount =
      issueCounts[AnalysisPhotoPreflightIssueValue.NoLocalFaceDetected] ?? 0;
    const localFaceRejectionRate =
      localFaceRejectedCount / Math.max(1, entries.length);
    const aiNoFaceRate =
      aiNoFaceCount / Math.max(1, completedWithAnalysisCount);
    const mlDetectorReviewReasons: string[] = [];
    if (
      localFaceRejectionRate >=
      SKIN_JOURNAL_LOCAL_FACE_REJECTION_RATE_ML_REVIEW_THRESHOLD
    ) {
      mlDetectorReviewReasons.push('local_face_rejection_rate_high');
    }
    if (aiNoFaceRate >= SKIN_JOURNAL_AI_NO_FACE_RATE_ML_REVIEW_THRESHOLD) {
      mlDetectorReviewReasons.push('ai_no_face_rate_high');
    }

    return {
      rejected_count: rejectedCount,
      issue_counts: issueCounts,
      local_face_rejection_rate: localFaceRejectionRate,
      ai_no_face_rate: aiNoFaceRate,
      ml_detector_review_recommended: mlDetectorReviewReasons.length > 0,
      ml_detector_review_reasons: mlDetectorReviewReasons,
    };
  }

  private buildConcernCounts(
    entries: SkinJournalEntry[],
  ): Partial<Record<AnalysisConcern, number>> {
    const counts: Partial<Record<AnalysisConcern, number>> = {};
    for (const entry of entries) {
      for (const concern of entry.analysis_observations?.detected_concerns ??
        []) {
        counts[concern.concern] = (counts[concern.concern] ?? 0) + 1;
      }
    }
    return counts;
  }

  private buildPerAngleQualityOperationsMetrics(
    entries: SkinJournalEntry[],
  ): AngleQualityOperationsMetrics {
    const accumulators = Object.fromEntries(
      SKIN_JOURNAL_PHOTO_ANGLES.map((angle) => [
        angle,
        {
          count: 0,
          qualityScoreSum: 0,
          qualityScoreCount: 0,
          needsRetakeCount: 0,
          faceMissingCount: 0,
          usedForAnalysisCount: 0,
          poorQualityCount: 0,
        },
      ]),
    ) as Record<
      Angle,
      {
        count: number;
        qualityScoreSum: number;
        qualityScoreCount: number;
        needsRetakeCount: number;
        faceMissingCount: number;
        usedForAnalysisCount: number;
        poorQualityCount: number;
      }
    >;

    for (const entry of entries) {
      for (const quality of entry.analysis_observations?.per_angle_quality ??
        []) {
        const accumulator = accumulators[quality.angle];
        accumulator.count += 1;
        if (typeof quality.quality_score === 'number') {
          accumulator.qualityScoreSum += quality.quality_score;
          accumulator.qualityScoreCount += 1;
        }
        if (quality.needs_retake) accumulator.needsRetakeCount += 1;
        if (!quality.face_detected) accumulator.faceMissingCount += 1;
        if (quality.used_for_analysis) accumulator.usedForAnalysisCount += 1;
        if (
          quality.needs_retake ||
          quality.lighting_quality === 'poor' ||
          quality.framing_quality === 'poor' ||
          quality.blur_detected ||
          !quality.face_detected
        ) {
          accumulator.poorQualityCount += 1;
        }
      }
    }

    return Object.fromEntries(
      SKIN_JOURNAL_PHOTO_ANGLES.map((angle) => {
        const accumulator = accumulators[angle];
        const denominator = Math.max(1, accumulator.count);
        const averageQualityScore =
          accumulator.qualityScoreCount > 0
            ? Number(
                (
                  accumulator.qualityScoreSum / accumulator.qualityScoreCount
                ).toFixed(3),
              )
            : null;
        return [
          angle,
          {
            count: accumulator.count,
            average_quality_score: averageQualityScore,
            needs_retake_rate: accumulator.needsRetakeCount / denominator,
            face_missing_rate: accumulator.faceMissingCount / denominator,
            used_for_analysis_rate:
              accumulator.usedForAnalysisCount / denominator,
            poor_quality_rate: accumulator.poorQualityCount / denominator,
          },
        ];
      }),
    ) as AngleQualityOperationsMetrics;
  }

  private scheduleAnalysisRecovery(): void {
    if (this.analysisRecoveryTimer) {
      clearTimeout(this.analysisRecoveryTimer);
      this.analysisRecoveryTimer = null;
    }
    this.analysisRecoveryTimer = setTimeout(() => {
      void this.recoverInterruptedAnalyses()
        .catch((error) => {
          this.logger.error(
            'Failed to run scheduled skin journal analysis recovery',
            error,
          );
        })
        .finally(() => this.scheduleAnalysisRecovery());
    }, SKIN_JOURNAL_ANALYSIS_RECOVERY_INTERVAL_MS);
    this.analysisRecoveryTimer.unref?.();
  }

  private assertOperationsToken(token: string | undefined): void {
    const configuredToken = this.config.getOrThrow<string>(
      'SKIN_JOURNAL_OPERATIONS_TOKEN',
    );
    if (!configuredToken || token !== configuredToken) {
      throw new ForbiddenException('Invalid operations token');
    }
  }

  async recordEvent(
    userId: string,
    entryId: string,
    params: {
      kind: SkinJournalEvent['kind'];
      severity: SkinJournalEvent['severity'];
      payload?: Record<string, unknown>;
    },
  ): Promise<SkinJournalEvent> {
    const event = this.events.create({
      user_id: userId,
      entry_id: entryId,
      kind: params.kind,
      severity: params.severity,
      payload: params.payload ?? null,
    });
    return this.events.save(event);
  }

  async recordEventOnce(
    userId: string,
    entryId: string | null | undefined,
    params: {
      kind: SkinJournalEvent['kind'];
      severity: SkinJournalEvent['severity'];
      payload?: Record<string, unknown>;
    },
  ): Promise<SkinJournalEvent | null> {
    if (!entryId) {
      return null;
    }
    const existing = await this.events.findOne({
      where: {
        user_id: userId,
        entry_id: entryId,
        kind: params.kind,
      },
    });
    if (existing) {
      return existing;
    }
    return this.recordEvent(userId, entryId, params);
  }

  async listEvents(
    userId: string,
    filters: {
      kind?: EventKind;
      from?: string;
      to?: string;
      acknowledged?: boolean;
    } = {},
  ): Promise<JournalEventResponseDto[]> {
    if (filters.from && !isValidDate(filters.from)) {
      throw new BadRequestException('Invalid from date');
    }
    if (filters.to && !isValidDate(filters.to)) {
      throw new BadRequestException('Invalid to date');
    }
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new BadRequestException('Date range must start before it ends');
    }
    if (filters.kind && !EVENT_KINDS.has(filters.kind)) {
      throw new BadRequestException('Invalid event kind');
    }
    const where: FindOptionsWhere<SkinJournalEvent> = { user_id: userId };
    if (filters.kind) {
      where.kind = filters.kind;
    }
    if (filters.acknowledged === true) {
      where.acknowledged_at = Not(IsNull());
    } else if (filters.acknowledged === false) {
      where.acknowledged_at = IsNull();
    }
    const filteredEntryIds =
      filters.from || filters.to
        ? await this.entryIdsForDateRange(
            userId,
            filters.from ?? '1900-01-01',
            filters.to ?? '2999-12-31',
          )
        : null;
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    if (filteredEntryIds && filteredEntryIds.size === 0) {
      return [];
    }
    if (filteredEntryIds) {
      where.entry_id = In([...filteredEntryIds]);
    }
    const events = await this.events.find({
      where,
      order: { created_at: 'DESC' },
      take: 100,
    });
    const filtered = filteredEntryIds
      ? events.filter((event) => filteredEntryIds.has(event.entry_id))
      : events;
    return filtered.map((e) => JournalEventResponseDto.fromEntity(e));
  }

  async listEventsForEntryDates(
    userId: string,
    from: string,
    to: string,
  ): Promise<SkinJournalEvent[]> {
    const filteredEntryIds = await this.entryIdsForDateRange(userId, from, to);
    if (filteredEntryIds.size === 0) {
      return [];
    }
    const events = await this.events.find({
      where: { user_id: userId, entry_id: In([...filteredEntryIds]) },
      order: { created_at: 'DESC' },
      take: 100,
    });
    return events.filter((event) => filteredEntryIds.has(event.entry_id));
  }

  async acknowledgeEvent(
    userId: string,
    eventId: string,
  ): Promise<JournalEventResponseDto> {
    const event = await this.events.findOne({
      where: { id: eventId, user_id: userId },
    });
    if (!event) throw new NotFoundException('Event not found');
    event.acknowledged_at = new Date();
    await this.events.save(event);
    return JournalEventResponseDto.fromEntity(event);
  }

  async listInsights(
    userId: string,
    options: InsightQueryOptions = {},
  ): Promise<JournalInsightsResponseDto> {
    const list = await this.insights.find({
      where: { user_id: userId, dismissed_at: IsNull() },
      order: { generated_at: 'DESC' },
      take: 50,
    });
    const filtered = this.filterInsightsByWindow(list, options.window);
    const entryPreviewById = await this.buildInsightEntryPreviewMap(
      userId,
      filtered,
    );
    await this.recordDataAccess(
      userId,
      UserDataAccessPurpose.SkinJournalInsight,
    );
    return {
      insights: filtered.map((insight) =>
        this.toInsightResponseDto(insight, entryPreviewById),
      ),
      meta: await this.buildInsightsMeta(userId),
    };
  }

  async dismissInsight(userId: string, insightId: string): Promise<void> {
    const insight = await this.insights.findOne({
      where: { id: insightId, user_id: userId },
    });
    if (!insight) throw new NotFoundException('Insight not found');
    insight.dismissed_at = nowDate();
    await this.insights.save(insight);
    await this.recordInsightInteraction({
      userId,
      insightId,
      interactionType: InsightInteractionTypeValue.Dismissed,
      actionKind: null,
    });
  }

  async markInsightSeen(userId: string, insightId: string): Promise<void> {
    const insight = await this.insights.findOne({
      where: { id: insightId, user_id: userId },
    });
    if (!insight) return;
    if (!insight.seen_at) {
      insight.seen_at = nowDate();
      await this.insights.save(insight);
      await this.recordInsightInteraction({
        userId,
        insightId,
        interactionType: InsightInteractionTypeValue.Seen,
        actionKind: null,
      });
    }
  }

  async recordInsightAction(
    userId: string,
    insightId: string,
    params: { action_kind: InsightAction['kind'] },
  ): Promise<void> {
    const insight = await this.insights.findOne({
      where: { id: insightId, user_id: userId },
    });
    if (!insight) throw new NotFoundException('Insight not found');
    if (!insight.seen_at) {
      insight.seen_at = nowDate();
      await this.insights.save(insight);
      await this.recordInsightInteraction({
        userId,
        insightId,
        interactionType: InsightInteractionTypeValue.Seen,
        actionKind: null,
      });
    }
    await this.recordInsightInteraction({
      userId,
      insightId,
      interactionType: InsightInteractionTypeValue.ActionClicked,
      actionKind: params.action_kind,
    });
  }

  private async recordInsightInteraction(params: {
    userId: string;
    insightId: string;
    interactionType: SkinJournalInsightInteraction['interaction_type'];
    actionKind: SkinJournalInsightInteraction['action_kind'];
  }): Promise<void> {
    await this.insightInteractions.save(
      this.insightInteractions.create({
        user_id: params.userId,
        insight_id: params.insightId,
        interaction_type: params.interactionType,
        action_kind: params.actionKind,
      }),
    );
  }

  async generateInsightsIfNeeded(
    userId: string,
    locale = 'en',
  ): Promise<boolean> {
    const snapshot = await this.buildInsightInputSnapshot(userId);
    if (!snapshot) {
      await this.updateInsightStateAfterSchedulerCheck(userId, null, 0);
      return false;
    }

    const state = await this.insightStates.findOne({
      where: { user_id: userId },
    });
    const cadence = await this.loadInsightCadenceSettings(userId);
    const activeJob = await this.insightQueue.getActiveJobForUser(userId);
    if (activeJob) {
      await this.updateInsightStateAfterSchedulerCheck(
        userId,
        snapshot.signature,
        snapshot.entryCount,
      );
      return false;
    }

    if (!this.shouldQueuePeriodicInsightGeneration(state, snapshot, cadence)) {
      await this.updateInsightStateAfterSchedulerCheck(
        userId,
        snapshot.signature,
        snapshot.entryCount,
      );
      return false;
    }

    await this.enqueueInsightGeneration(
      userId,
      'scheduled_refresh',
      locale,
      snapshot.signature,
    );
    return true;
  }

  private async enqueueInsightGeneration(
    userId: string,
    trigger: InsightGenerationTrigger,
    locale = 'en',
    inputSignature?: string,
  ): Promise<void> {
    const signature =
      inputSignature ?? (await this.buildInsightInputSignature(userId));
    if (!signature) {
      return;
    }
    await this.insightQueue.enqueueInsightJob({
      userId,
      trigger,
      locale,
      inputSignature: signature,
      reason: `Insight generation queued after ${trigger}.`,
    });
  }

  private shouldQueuePeriodicInsightGeneration(
    state: SkinJournalInsightState | null,
    snapshot: { signature: string; entryCount: number },
    cadence: InsightCadenceSettings,
  ): boolean {
    if (
      snapshot.entryCount <
      SKIN_JOURNAL_INSIGHT_MIN_ENTRIES_FOR_PERIODIC_GENERATION
    ) {
      return false;
    }

    if (state?.last_generated_signature === snapshot.signature) {
      return false;
    }

    if (
      !state?.dirty_since &&
      state?.latest_input_signature === snapshot.signature
    ) {
      return false;
    }

    if (
      state?.last_failed_signature === snapshot.signature &&
      state.last_failed_at
    ) {
      const nextRetryAt = new Date(state.last_failed_at);
      nextRetryAt.setUTCDate(
        nextRetryAt.getUTCDate() +
          SKIN_JOURNAL_INSIGHT_FAILED_RETRY_COOLDOWN_DAYS,
      );
      if (nextRetryAt.getTime() > Date.now()) {
        return false;
      }
    }

    if (!state?.last_generated_at) {
      return true;
    }

    const nextEligibleAt = new Date(state.last_generated_at);
    nextEligibleAt.setUTCDate(
      nextEligibleAt.getUTCDate() +
        INSIGHT_CADENCE_INTERVAL_DAYS[cadence.cadence],
    );
    return (
      nextEligibleAt.getTime() <= Date.now() &&
      isInsightDigestWindowOpen(nowDate(), cadence)
    );
  }

  private async loadInsightCadenceSettings(
    userId: string,
  ): Promise<InsightCadenceSettings> {
    const [prefs, user] = await Promise.all([
      this.notifications.getPreferences(userId),
      this.users.findOne({
        where: { id: userId },
        select: { id: true, time_zone: true },
      }),
    ]);
    return {
      cadence: normalizeInsightCadence(prefs.insight_cadence),
      digestDay: normalizeInsightDigestDay(prefs.insight_digest_day),
      digestLocalTime: normalizeInsightDigestLocalTime(
        prefs.insight_digest_local_time,
      ),
      timeZone: resolveSkinJournalTimeZone(user?.time_zone ?? null),
    };
  }

  private async updateInsightStateAfterSchedulerCheck(
    userId: string,
    signature: string | null,
    entryCount: number,
  ): Promise<void> {
    const current = await this.insightStates.findOne({
      where: { user_id: userId },
    });
    const state =
      current ??
      this.insightStates.create({
        user_id: userId,
        dirty_since: null,
        dirty_reasons: [],
        last_generated_signature: null,
        last_generated_at: null,
        last_generation_trigger: null,
      });
    state.latest_input_signature = signature;
    state.latest_entry_count = entryCount;
    state.last_checked_at = nowDate();
    if (!signature || state.last_generated_signature === signature) {
      state.dirty_since = null;
      state.dirty_reasons = [];
    }
    await this.insightStates.save(state);
  }

  private async buildInsightInputSignature(
    userId: string,
  ): Promise<string | null> {
    const snapshot = await this.buildInsightInputSnapshot(userId);
    return snapshot?.signature ?? null;
  }

  private async buildInsightInputSnapshot(
    userId: string,
  ): Promise<{ signature: string; entryCount: number } | null> {
    const [recentEntries, entryCount] = await Promise.all([
      this.entries.find({
        where: { user_id: userId },
        order: { entry_date: 'DESC' },
        take: 30,
      }),
      this.entries.count({ where: { user_id: userId } }),
    ]);
    if (recentEntries.length === 0) {
      return null;
    }
    const routineApplications = await this.loadInsightRoutineApplications(
      userId,
      recentEntries,
    );
    const normalizedEntryCount = Math.max(entryCount, recentEntries.length);
    return {
      signature: this.hashInsightInputs(recentEntries, routineApplications),
      entryCount: normalizedEntryCount,
    };
  }

  private async loadInsightRoutineApplications(
    userId: string,
    entries: SkinJournalEntry[],
  ): Promise<RoutineApplicationEvidence[]> {
    if (entries.length === 0) {
      return [];
    }
    const dates = entries.map((entry) => entry.entry_date).sort();
    const start = dates[0];
    const end = dates.at(-1) ?? start;
    const logs = await this.applicationLogs.find({
      where: {
        user_id: userId,
        target_date: Between(start, end),
      },
      relations: { items: true },
      select: {
        id: true,
        user_id: true,
        suggestion_instance_id: true,
        slot_id: true,
        target_date: true,
        target_time: true,
        daypart: true,
        updated_at: true,
        has_been_edited: true,
        items: {
          id: true,
          application_log_id: true,
          step_order: true,
          suggestion_step_id: true,
          status: true,
          step_label: true,
          inventory_product_id: true,
          substituted_with_product_id: true,
          applied_at: true,
          item_source: true,
          is_ad_hoc: true,
        },
      },
      order: { target_date: 'ASC' },
    });

    const compareNullable = (
      left: string | null | undefined,
      right: string | null | undefined,
    ) => (left ?? '').localeCompare(right ?? '');

    return [...logs]
      .sort(
        (left, right) =>
          left.target_date.localeCompare(right.target_date) ||
          left.id.localeCompare(right.id),
      )
      .map((log) => ({
        id: log.id,
        suggestion_instance_id: log.suggestion_instance_id,
        slot_id: log.slot_id,
        target_date: log.target_date,
        target_time: log.target_time,
        daypart: log.daypart,
        updated_at: log.updated_at?.toISOString?.() ?? null,
        has_been_edited: log.has_been_edited,
        items: [...(log.items ?? [])]
          .sort((left, right) => {
            return (
              left.step_order - right.step_order ||
              compareNullable(left.step_label, right.step_label) ||
              compareNullable(
                left.inventory_product_id,
                right.inventory_product_id,
              ) ||
              compareNullable(
                left.substituted_with_product_id,
                right.substituted_with_product_id,
              ) ||
              left.status.localeCompare(right.status) ||
              compareNullable(
                left.applied_at?.toISOString?.(),
                right.applied_at?.toISOString?.(),
              )
            );
          })
          .map((item) => ({
            step_order: item.step_order,
            suggestion_step_id: item.suggestion_step_id,
            status: item.status,
            step_label: item.step_label,
            inventory_product_id: item.inventory_product_id,
            substituted_with_product_id: item.substituted_with_product_id,
            applied_at: item.applied_at?.toISOString?.() ?? null,
            item_source: item.item_source,
            is_ad_hoc: item.is_ad_hoc,
          })),
      }));
  }

  private hashInsightInputs(
    entries: SkinJournalEntry[],
    routineApplications: RoutineApplicationEvidence[] = [],
  ): string {
    const entryPayload = [...entries]
      .sort((left, right) => left.entry_date.localeCompare(right.entry_date))
      .map((entry) => ({
        id: entry.id,
        entry_date: entry.entry_date,
        updated_at: entry.updated_at?.toISOString?.() ?? null,
        photo_object_key: entry.photo_object_key,
        analysis_status: entry.analysis_status,
        analysis_concern_keys: entry.analysis_concern_keys,
        has_reaction_signal: entry.has_reaction_signal,
        needs_retake: entry.needs_retake,
        analysis_summary: entry.analysis_summary,
        analysis_observations: entry.analysis_observations,
        analysis_interpretation: entry.analysis_interpretation,
        ratings: entry.ratings,
        overall_feel: entry.overall_feel,
        sleep_band: entry.sleep_band,
        stress_today: entry.stress_today,
        sun_exposure_today: entry.sun_exposure_today,
        sweat_exercise_today: entry.sweat_exercise_today,
        cycle_marker: entry.cycle_marker,
        recent_change: entry.recent_change,
        complaint_note: entry.complaint_note,
      }));
    const payload =
      routineApplications.length > 0
        ? {
            entries: entryPayload,
            routine_applications: routineApplications,
          }
        : entryPayload;
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  async processInsightJob(job: SkinJournalInsightJob): Promise<void> {
    const currentSignature = await this.buildInsightInputSignature(job.user_id);
    if (!currentSignature) {
      await this.updateInsightStateAfterSchedulerCheck(job.user_id, null, 0);
      await this.insightQueue.completeJob(job);
      return;
    }
    if (currentSignature !== job.input_signature) {
      await this.markInsightsAfterJournalChange(job.user_id, job.trigger);
      await this.insightQueue.cancelJob(
        job,
        'Insight inputs changed before the scheduled job ran.',
      );
      return;
    }

    try {
      await this.generateInsights(job.user_id, {
        trigger: job.trigger,
        locale: job.locale,
        expectedInputSignature: currentSignature,
      });
      await this.markInsightGenerationCompleted(
        job.user_id,
        currentSignature,
        job.trigger,
      );
      await this.insightQueue.completeJob(job);
    } catch (error) {
      if (error instanceof InsightInputChangedError) {
        const refreshedSignature = await this.buildInsightInputSignature(
          job.user_id,
        );
        if (!refreshedSignature) {
          await this.updateInsightStateAfterSchedulerCheck(
            job.user_id,
            null,
            0,
          );
          await this.insightQueue.completeJob(job);
          return;
        }
        await this.markInsightsAfterJournalChange(job.user_id, job.trigger);
        await this.insightQueue.cancelJob(
          job,
          'Insight inputs changed while generation was running.',
        );
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Insight generation failed';
      const shouldRetry =
        job.attempt_count <
        (job.max_attempts || this.insightQueue.getMaxAttempts());
      if (shouldRetry) {
        await this.insightQueue.rescheduleJob(job, {
          reason: errorMessage,
          runAfter: this.insightQueue.nextRetryAt(job.attempt_count),
        });
        return;
      }
      await this.markInsightGenerationFailed(job.user_id, currentSignature);
      await this.insightQueue.failJob(job, errorMessage);
    }
  }

  private async generateInsights(
    userId: string,
    options: InsightGenerationOptions,
  ): Promise<void> {
    const startedAt = Date.now();
    const recentEntries = await this.entries.find({
      where: { user_id: userId },
      order: { entry_date: 'DESC' },
      take: 30,
    });
    if (recentEntries.length === 0) return;
    const routineApplications = await this.loadInsightRoutineApplications(
      userId,
      recentEntries,
    );

    const entriesAsc = [...recentEntries].sort((a, b) =>
      a.entry_date.localeCompare(b.entry_date),
    );
    const run = await this.insightRuns.save(
      this.insightRuns.create({
        user_id: userId,
        trigger: options.trigger,
        status: InsightGenerationStatusValue.Running,
        data_window_start: entriesAsc[0].entry_date,
        data_window_end:
          entriesAsc.at(-1)?.entry_date ?? entriesAsc[0].entry_date,
        data_cutoff_at: nowDate(),
        insight_count: 0,
        duration_ms: 0,
        ai_model: null,
        ai_input_tokens: null,
        ai_output_tokens: null,
        ai_total_tokens: null,
        ai_estimated_cost_usd: null,
        completed_at: null,
        error: null,
      }),
    );

    try {
      const aiPolishEnabled = true;
      const aiSummaryEnabled =
        aiPolishEnabled && SKIN_JOURNAL_INSIGHT_SUMMARY_CARDS_ENABLED;
      const aiPatternEnabled =
        aiPolishEnabled && SKIN_JOURNAL_INSIGHT_PATTERN_CARDS_ENABLED;
      const generatedAt = nowDate();
      const candidates = buildDeterministicInsights(recentEntries, {
        trigger: options.trigger,
        generatedAt,
        aiSummaryEnabled,
        aiPatternEnabled,
        routineApplications,
      });
      const polishResult = await this.insightPolish.polishWithUsage(
        candidates,
        {
          locale: options.locale ?? 'en',
          aiPolishEnabled,
        },
      );
      this.applyInsightRunAiUsage(run, polishResult.usage);
      const polished = polishResult.candidates;

      if (
        options.expectedInputSignature &&
        (await this.buildInsightInputSignature(userId)) !==
          options.expectedInputSignature
      ) {
        throw new InsightInputChangedError();
      }

      let createdCount = 0;
      const createdInsightIds: string[] = [];
      let strongestInsightSeverity: NotificationSeverity = 'info';
      for (const candidate of polished) {
        const existing = await this.findExistingInsight(userId, {
          kind: candidate.kind,
          insight_signature: candidate.insight_signature,
        });
        if (existing) {
          continue;
        }
        const insight = await this.saveInsightCandidate(userId, candidate);
        if (!insight) {
          continue;
        }
        createdCount += 1;
        createdInsightIds.push(insight.id);
        strongestInsightSeverity = this.strongestNotificationSeverity(
          strongestInsightSeverity,
          candidate.severity,
        );
        await this.recordDataAccess(
          userId,
          UserDataAccessPurpose.SkinJournalInsight,
          UserDataAccessActorType.System,
        );
        if (candidate.kind === 'effectiveness') {
          await this.recordEventOnce(
            userId,
            candidate.source_entry_ids.at(-1),
            {
              kind: 'product_effectiveness',
              severity: candidate.severity,
              payload: {
                insight_id: insight.id,
                signature: candidate.insight_signature,
              },
            },
          );
        }
      }
      if (createdCount > 0) {
        await this.dispatchNotification({
          userId,
          kind: 'insight_ready',
          titleKey: NOTIFICATION_KEYS.insightTitle,
          bodyKey: NOTIFICATION_KEYS.insightBody,
          severity: strongestInsightSeverity,
          payload: {
            insight_ids: createdInsightIds,
            insight_count: createdCount,
          },
          deepLink: '/journal?tab=insights',
        });
      }
      run.status = InsightGenerationStatusValue.Completed;
      run.insight_count = createdCount;
      run.completed_at = nowDate();
      run.duration_ms = Date.now() - startedAt;
      await this.insightRuns.save(run);
    } catch (error) {
      run.status = InsightGenerationStatusValue.Failed;
      run.error =
        error instanceof Error ? error.message : 'Insight generation failed';
      run.completed_at = nowDate();
      run.duration_ms = Date.now() - startedAt;
      await this.insightRuns.save(run);
      throw error;
    }
  }

  private applyInsightRunAiUsage(
    run: SkinJournalInsightGenerationRun,
    usage: InsightPolishUsage | null,
  ): void {
    if (!usage) {
      return;
    }
    run.ai_model = usage.model;
    run.ai_input_tokens = usage.inputTokens;
    run.ai_output_tokens = usage.outputTokens;
    run.ai_total_tokens = usage.totalTokens;
    run.ai_estimated_cost_usd = usage.estimatedCostUsd;
  }

  private async findExistingInsight(
    userId: string,
    params: { kind: InsightKind; insight_signature: string },
  ): Promise<SkinJournalInsight | null> {
    return this.insights.findOne({
      where: {
        user_id: userId,
        kind: params.kind,
        insight_signature: params.insight_signature,
      },
    });
  }

  private async saveInsightCandidate(
    userId: string,
    candidate: InsightCandidate,
  ): Promise<SkinJournalInsight | null> {
    try {
      return await this.insights.save(
        this.insights.create({
          user_id: userId,
          kind: candidate.kind,
          severity: candidate.severity,
          confidence: candidate.confidence,
          headline: candidate.headline,
          blocks: candidate.blocks,
          actions: candidate.actions,
          caveats: candidate.caveats,
          source_entry_ids: candidate.source_entry_ids,
          time_window: candidate.time_window,
          data_cutoff_at: new Date(candidate.data_cutoff_at),
          generation_trigger: candidate.generation_trigger,
          metadata: candidate.metadata,
          sources: this.knowledgeBase.resolveMany(candidate.referenced_kb_ids),
          insight_signature: candidate.insight_signature,
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  private filterInsightsByWindow(
    insights: SkinJournalInsight[],
    window: InsightWindow | undefined,
  ): SkinJournalInsight[] {
    if (!window || window === 'all') {
      return insights;
    }
    const days = window === 'week' ? 7 : 30;
    const threshold = nowDate();
    threshold.setUTCDate(threshold.getUTCDate() - days);
    return insights.filter((insight) => insight.generated_at >= threshold);
  }

  private async buildInsightsMeta(
    userId: string,
  ): Promise<JournalInsightsResponseDto['meta']> {
    const [totalEntries, lastRun, activeJob] = await Promise.all([
      this.entries.count({ where: { user_id: userId } }),
      this.insightRuns.findOne({
        where: {
          user_id: userId,
          status: InsightGenerationStatusValue.Completed,
        },
        order: { completed_at: 'DESC' },
      }),
      this.insightQueue.getActiveJobForUser(userId),
    ]);
    const nextUnlock =
      totalEntries < 7
        ? 7
        : totalEntries < 14
          ? 14
          : totalEntries < 30
            ? 30
            : totalEntries;
    return {
      total_entries: totalEntries,
      entries_until_next_insight: Math.max(nextUnlock - totalEntries, 0),
      last_generated_at: lastRun?.completed_at ?? null,
      generation_status: activeJob?.status ?? 'idle',
      active_job_trigger: activeJob?.trigger ?? null,
      active_job_run_after: activeJob?.run_after ?? null,
      active_job_last_error: activeJob?.last_error ?? null,
    };
  }

  private async buildInsightEntryPreviewMap(
    userId: string,
    insights: SkinJournalInsight[],
  ): Promise<Map<string, InsightEntryPreview>> {
    const entryIds = [
      ...new Set(
        insights.flatMap((insight) =>
          insight.blocks.flatMap((block) =>
            block.type === 'entry_thumbs' ? block.entry_ids : [],
          ),
        ),
      ),
    ];
    if (entryIds.length === 0) {
      return new Map();
    }

    const entries = await this.entries.find({
      where: { user_id: userId, id: In(entryIds) },
    });

    return new Map(
      entries.map((entry) => [
        entry.id,
        {
          entry_id: entry.id,
          date: entry.entry_date,
          photo_url: this.photoStorage.getSignedUrl(entry.photo_object_key),
        },
      ]),
    );
  }

  private toInsightResponseDto(
    insight: SkinJournalInsight,
    entryPreviewById: Map<string, InsightEntryPreview>,
  ): JournalInsightResponseDto {
    const dto = JournalInsightResponseDto.fromEntity(insight);
    dto.blocks = dto.blocks.map((block): InsightBlock => {
      if (block.type !== 'entry_thumbs') {
        return block;
      }
      return {
        ...block,
        entries: block.entry_ids
          .map((entryId) => entryPreviewById.get(entryId))
          .filter((entry): entry is InsightEntryPreview => !!entry),
      };
    });
    return dto;
  }

  async listWrapped(userId: string): Promise<WrappedResponseDto[]> {
    if (!SKIN_JOURNAL_WRAPPED_ENABLED) {
      await this.recordDataAccess(
        userId,
        UserDataAccessPurpose.SkinJournalRead,
      );
      return [];
    }

    const list = await this.wrapped.find({
      where: { user_id: userId },
      order: { period_start: 'DESC' },
    });
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    return list.map((wrapped) =>
      toWrappedResponseDto(wrapped, (objectKey, options) =>
        this.photoStorage.getSignedUrl(objectKey, options),
      ),
    );
  }

  async getWrapped(
    userId: string,
    wrappedId: string,
  ): Promise<WrappedResponseDto> {
    if (!SKIN_JOURNAL_WRAPPED_ENABLED) {
      throw new NotImplementedException(
        'Skin Journal Wrapped is not ready yet',
      );
    }

    const wrapped = await this.wrapped.findOne({
      where: { id: wrappedId, user_id: userId },
    });
    if (!wrapped) throw new NotFoundException('Wrapped not found');
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    return toWrappedResponseDto(wrapped, (objectKey, options) =>
      this.photoStorage.getSignedUrl(objectKey, options),
    );
  }

  async getActiveSimplification(
    userId: string,
  ): Promise<SimplificationResponseDto | null> {
    const evt = await this.simplifications.findOne({
      where: { user_id: userId, ended_at: IsNull() },
      order: { started_at: 'DESC' },
    });
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    return evt ? SimplificationResponseDto.fromEntity(evt) : null;
  }

  async getSimplification(
    userId: string,
    id: string,
  ): Promise<SimplificationResponseDto> {
    const evt = await this.simplifications.findOne({
      where: { id, user_id: userId },
    });
    if (!evt) throw new NotFoundException('Simplification not found');
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    return SimplificationResponseDto.fromEntity(evt);
  }

  async startSimplification(params: {
    userId: string;
    triggeredByEventId: string | null;
    reason: string;
  }): Promise<SimplificationResponseDto> {
    const existing = await this.simplifications.findOne({
      where: { user_id: params.userId, ended_at: IsNull() },
    });
    if (existing) {
      return SimplificationResponseDto.fromEntity(existing);
    }
    const event = this.simplifications.create({
      user_id: params.userId,
      triggered_by_event_id: params.triggeredByEventId,
      simplification_mode: 'barrier_repair',
      reason: params.reason,
      original_schedule_snapshot: null,
      restore_strategy: 'full',
    });
    const saved = await this.simplifications.save(event);
    await this.recordDataAccess(
      params.userId,
      UserDataAccessPurpose.SkinJournalSimplification,
      UserDataAccessActorType.System,
    );
    return SimplificationResponseDto.fromEntity(saved);
  }

  async acknowledgeSimplification(
    userId: string,
    id: string,
  ): Promise<SimplificationResponseDto> {
    const evt = await this.simplifications.findOne({
      where: { id, user_id: userId },
    });
    if (!evt) throw new NotFoundException('Simplification not found');
    evt.acknowledged_at = new Date();
    evt.ended_at = new Date();
    await this.simplifications.save(evt);
    await this.recordDataAccess(
      userId,
      UserDataAccessPurpose.SkinJournalSimplification,
    );
    return SimplificationResponseDto.fromEntity(evt);
  }

  async getStats(userId: string): Promise<JournalStatsResponseDto> {
    const all = await this.entries.find({
      where: { user_id: userId },
      order: { entry_date: 'DESC' },
    });
    const total = all.length;
    let streak = 0;
    if (total > 0) {
      const today = todayInTimeZone(all[0].time_zone);
      const cursor = new Date(`${today}T00:00:00Z`);
      const dateSet = new Set(all.map((e) => e.entry_date));
      while (true) {
        const key = cursor.toISOString().slice(0, 10);
        if (dateSet.has(key)) {
          streak += 1;
          cursor.setUTCDate(cursor.getUTCDate() - 1);
        } else {
          break;
        }
      }
    }
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    const recent = await this.entries.count({
      where: {
        user_id: userId,
        entry_date: MoreThanOrEqual(sevenDaysAgo.toISOString().slice(0, 10)),
      },
    });
    const firstEntry = all.length > 0 ? all[all.length - 1].entry_date : null;
    return {
      current_streak: streak,
      total_entries: total,
      weekly_uploads: recent,
      weekly_target: 7,
      weekly_upload_rate: Math.min(100, Math.round((recent / 7) * 100)),
      first_entry_date: firstEntry,
    };
  }

  async createExport(
    userId: string,
    dto: CreateJournalExportDto,
  ): Promise<JournalExportResponseDto> {
    this.validateDateRange(dto.from, dto.to);
    await this.recordDataAccess(
      userId,
      UserDataAccessPurpose.SkinJournalExport,
    );

    const payload = await this.buildExportPayload(userId, dto.from, dto.to);

    const jobEntity = this.exportJobs.create({
      user_id: userId,
      range_from: dto.from,
      range_to: dto.to,
      status: ExportStatusValue.Ready,
      payload,
      error: null,
    });
    const job = await this.exportJobs.save(jobEntity);

    await this.dispatchNotification({
      userId,
      kind: 'export_ready',
      titleKey: NOTIFICATION_KEYS.exportReadyTitle,
      bodyKey: NOTIFICATION_KEYS.exportReadyBody,
      payload: { job_id: job.id, from: dto.from, to: dto.to },
      deepLink: `/journal/export/${job.id}`,
    });

    return toExportResponse(job, (objectKey, options) =>
      this.photoStorage.getSignedUrl(objectKey, options),
    );
  }

  async exportAllDataForAccount(
    userId: string,
  ): Promise<SkinJournalExportPayload> {
    await this.recordDataAccess(userId, UserDataAccessPurpose.AccountExport);
    return this.buildExportPayload(userId, '1900-01-01', '2999-12-31');
  }

  async deleteAllMediaForUser(userId: string): Promise<void> {
    const [entries, entryPhotos, wrapped] = await Promise.all([
      this.entries.find({ where: { user_id: userId } }),
      this.entryPhotos.find({ where: { user_id: userId } }),
      this.wrapped.find({ where: { user_id: userId } }),
    ]);
    const objectKeys = Array.from(
      new Set([
        ...entries
          .map((entry) => entry.photo_object_key)
          .filter((key): key is string => typeof key === 'string' && !!key),
        ...entryPhotos
          .map((photo) => photo.photo_object_key)
          .filter((key): key is string => typeof key === 'string' && !!key),
        ...wrapped
          .map((wrapped) => wrapped.media_object_key)
          .filter((key): key is string => typeof key === 'string' && !!key),
      ]),
    );
    for (const objectKey of objectKeys) {
      await this.deletePhotoForAccountDeletion(objectKey, userId);
    }
  }

  async getExport(
    userId: string,
    jobId: string,
  ): Promise<JournalExportResponseDto> {
    const job = await this.exportJobs.findOne({
      where: { id: jobId, user_id: userId },
    });
    if (!job) throw new NotFoundException('Export job not found');
    await this.recordDataAccess(
      userId,
      UserDataAccessPurpose.SkinJournalExport,
    );
    return toExportResponse(job, (objectKey, options) =>
      this.photoStorage.getSignedUrl(objectKey, options),
    );
  }

  private async findPreviousPhotoEntry(
    userId: string,
    currentEntry: SkinJournalEntry,
  ): Promise<SkinJournalEntry | null> {
    const candidates = await this.entries.find({
      where: {
        user_id: userId,
        entry_date: LessThan(currentEntry.entry_date),
        photo_object_key: Not(IsNull()),
        analysis_status: AnalysisStatusValue.Completed,
      } as FindOptionsWhere<SkinJournalEntry>,
      order: { entry_date: 'DESC' },
      take: 10,
    });
    return selectAnalysisReferenceEntry(
      candidates.filter(
        (candidate) =>
          candidate.id !== currentEntry.id &&
          candidate.entry_date < currentEntry.entry_date &&
          !!candidate.photo_object_key,
      ),
      currentEntry,
    );
  }

  private buildAnalysisSkinContext(
    profile: SkinProfile | null,
  ): AnalysisSkinContext | null {
    if (!profile) {
      return null;
    }
    return {
      skin_type: sanitizeContextText(profile.skin_type),
      skin_tone: sanitizeContextText(profile.skin_tone),
      fitzpatrick_phototype: sanitizeContextText(profile.fitzpatrick_phototype),
      sensitivity_level: sanitizeContextText(profile.sensitivity_level),
      hydration_level: sanitizeContextText(profile.hydration_level),
      current_concerns: sanitizeStringArray(profile.current_concerns),
      concern_details: sanitizeConcernDetails(
        profile.concern_details?.per_concern ?? [],
      ),
    };
  }

  private buildAnalysisEntryContext(
    entry: SkinJournalEntry,
  ): AnalysisEntryContext {
    return {
      entry_date: entry.entry_date,
      ratings: entry.ratings,
      overall_feel: entry.overall_feel,
      sleep_band: entry.sleep_band,
      stress_today: entry.stress_today,
      sun_exposure_today: entry.sun_exposure_today,
      sweat_exercise_today: entry.sweat_exercise_today,
      cycle_marker: entry.cycle_marker,
      recent_change_kind: entry.recent_change?.kind ?? null,
      complaint_note: sanitizeContextText(entry.complaint_note),
      is_pre_routine: entry.is_pre_routine,
    };
  }

  private async findOwnedEntry(
    userId: string,
    entryId: string,
  ): Promise<SkinJournalEntry> {
    const entry = await this.entries.findOne({
      where: { id: entryId, user_id: userId },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    return entry;
  }

  private assertEntryIsEditableToday(entry: SkinJournalEntry): void {
    const timeZone = resolveSkinJournalTimeZone(entry.time_zone);
    if (entry.entry_date !== todayInTimeZone(timeZone)) {
      throw new BadRequestException(JOURNAL_DAY_LOCKED_MESSAGE);
    }
  }

  private async clearEntryAnalysisArtifacts(
    userId: string,
    entryId: string,
  ): Promise<void> {
    await this.events.delete({ user_id: userId, entry_id: entryId });
    const insights = await this.insights.find({
      where: { user_id: userId },
      order: { generated_at: 'DESC' },
    });
    const staleInsightIds = insights
      .filter((insight) => insight.source_entry_ids?.includes(entryId))
      .map((insight) => insight.id);
    if (staleInsightIds.length > 0) {
      await this.insights.delete({
        user_id: userId,
        id: In(staleInsightIds),
      });
    }
  }

  private async entryIdsForDateRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<Set<string>> {
    const entries = await this.entries.find({
      where: { user_id: userId, entry_date: Between(from, to) },
      order: { entry_date: 'ASC' },
    });
    return new Set(entries.map((entry) => entry.id));
  }

  private async buildExportPayload(
    userId: string,
    from: string,
    to: string,
  ): Promise<SkinJournalExportPayload> {
    const [entries, events, insights, wrapped, simplifications] =
      await Promise.all([
        this.entries.find({
          where: { user_id: userId, entry_date: Between(from, to) },
          order: { entry_date: 'ASC' },
        }),
        this.listEventsForEntryDates(userId, from, to),
        this.insights.find({
          where: { user_id: userId },
          order: { generated_at: 'DESC' },
        }),
        SKIN_JOURNAL_WRAPPED_ENABLED
          ? this.wrapped.find({
              where: { user_id: userId },
              order: { period_start: 'DESC' },
            })
          : Promise.resolve([]),
        this.simplifications.find({
          where: { user_id: userId },
          order: { started_at: 'DESC' },
        }),
      ]);

    const entryIds = new Set(entries.map((entry) => entry.id));
    const photoRowsByEntry = await this.loadEntryPhotoRowsByEntryId(
      userId,
      entries.map((entry) => entry.id),
    );
    return {
      generated_at: new Date().toISOString(),
      from,
      to,
      entries: entries.map((entry) =>
        toExportEntryRecord(
          entry,
          this.normalizePhotoRowsForEntry(
            entry,
            photoRowsByEntry.get(entry.id) ?? [],
          ),
        ),
      ),
      events: events.map((event) => toExportEventRecord(event)),
      insights: insights
        .filter((insight) =>
          (insight.source_entry_ids ?? []).some((id) => entryIds.has(id)),
        )
        .map((insight) => toExportInsightRecord(insight)),
      wrapped: wrapped
        .filter(
          (wrapped) => wrapped.period_end >= from && wrapped.period_start <= to,
        )
        .map((wrapped) => toWrappedExportRecord(wrapped)),
      simplifications: simplifications.map((simplification) =>
        toExportSimplificationRecord(simplification),
      ),
    };
  }

  private computeDelta(
    from: SkinJournalEntry | null,
    to: SkinJournalEntry | null,
  ): {
    bullets: CompareDeltaBullet[];
  } {
    const bullets: CompareDeltaBullet[] = [];
    if (!from || !to) {
      return { bullets };
    }
    for (const c of CONCERN_KEYS) {
      const a = from.ratings?.[c];
      const b = to.ratings?.[c];
      if (typeof a === 'number' && typeof b === 'number' && a !== b) {
        const tone: 'good' | 'warn' | 'neutral' = b < a ? 'good' : 'warn';
        bullets.push({
          code: b < a ? 'rating_improved' : 'rating_worsened',
          tone,
          concern: c,
          from_rating: a,
          to_rating: b,
        });
      }
    }

    const qualityReason = firstCompareQualityLimitation(from, to);
    if (qualityReason) {
      bullets.push({
        code: 'not_comparable',
        tone: 'warn',
        reason: qualityReason,
      });
    } else {
      bullets.push(...this.computePhotoConcernDelta(from, to));
    }

    const reactionDelta = this.computeReactionDelta(from, to);
    if (reactionDelta) {
      bullets.push(reactionDelta);
    }

    const barrierDelta = this.computeBarrierDelta(from, to);
    if (barrierDelta) {
      bullets.push(barrierDelta);
    }

    if (bullets.length === 0) {
      bullets.push({ code: 'no_major_change', tone: 'neutral' });
    }
    return { bullets };
  }

  private computePhotoConcernDelta(
    from: SkinJournalEntry,
    to: SkinJournalEntry,
  ): CompareDeltaBullet[] {
    const fromConcerns = analysisConcernMap(from.analysis_observations);
    const toConcerns = analysisConcernMap(to.analysis_observations);
    const concerns = new Set([...fromConcerns.keys(), ...toConcerns.keys()]);
    const bullets: CompareDeltaBullet[] = [];

    for (const concern of concerns) {
      const previous = fromConcerns.get(concern);
      const current = toConcerns.get(concern);
      const previousSeverity = previous?.severity ?? 'none';
      const currentSeverity = current?.severity ?? 'none';
      const previousRank = severityRank(previousSeverity);
      const currentRank = severityRank(currentSeverity);
      if (previousRank === currentRank) {
        continue;
      }

      bullets.push({
        code:
          previousRank === 0
            ? 'photo_concern_new'
            : currentRank === 0
              ? 'photo_concern_cleared'
              : currentRank < previousRank
                ? 'photo_concern_improved'
                : 'photo_concern_worsened',
        tone: currentRank < previousRank ? 'good' : 'warn',
        analysis_concern: concern,
        from_severity: previousSeverity,
        to_severity: currentSeverity,
        confidence: current?.confidence ?? previous?.confidence ?? null,
      });
    }

    return bullets;
  }

  private computeReactionDelta(
    from: SkinJournalEntry,
    to: SkinJournalEntry,
  ): CompareDeltaBullet | null {
    const previous = reactionSeverity(from);
    const current = reactionSeverity(to);
    const previousRank = severityRank(previous);
    const currentRank = severityRank(current);
    if (previousRank === currentRank) {
      return null;
    }
    if (previousRank > 0 && currentRank === 0) {
      return {
        code: 'reaction_cleared',
        tone: 'good',
      };
    }
    return {
      code:
        currentRank < previousRank
          ? 'reaction_signal_reduced'
          : 'reaction_signal_increased',
      tone: currentRank < previousRank ? 'good' : 'warn',
      from_severity: previous,
      to_severity: current,
      confidence:
        to.analysis_observations?.reaction_signals.confidence ??
        from.analysis_observations?.reaction_signals.confidence ??
        null,
    };
  }

  private computeBarrierDelta(
    from: SkinJournalEntry,
    to: SkinJournalEntry,
  ): CompareDeltaBullet | null {
    const previous =
      from.analysis_observations?.barrier_signs.barrier_compromise;
    const current = to.analysis_observations?.barrier_signs.barrier_compromise;
    if (
      previous === current ||
      previous === undefined ||
      current === undefined
    ) {
      return null;
    }
    return {
      code: current ? 'barrier_signal_worsened' : 'barrier_signal_improved',
      tone: current ? 'warn' : 'good',
    };
  }

  private analysisConcernKeys(obs: AnalysisObservations): AnalysisConcern[] {
    const keys = new Set<AnalysisConcern>();
    for (const detected of obs.detected_concerns ?? []) {
      if (ANALYSIS_CONCERN_SET.has(detected.concern)) {
        keys.add(detected.concern);
      }
    }
    return Array.from(keys);
  }

  private async ensureSkinProgressConsent(
    userId: string,
    grantedNow: boolean,
  ): Promise<void> {
    const activeConsent = await this.consents.findOne({
      where: {
        user_id: userId,
        consent_type: SKIN_PROGRESS_CONSENT,
        granted: true,
        revoked_at: IsNull(),
      },
      order: { created_at: 'DESC' },
    });
    if (activeConsent) {
      return;
    }

    if (!grantedNow) {
      throw new ForbiddenException({
        code: 'skin_progress_consent_required',
        message:
          'Skin-progress processing consent is required before photo upload',
      });
    }

    await this.consents.save(
      this.consents.create({
        user_id: userId,
        consent_type: SKIN_PROGRESS_CONSENT,
        consent_version: '1.0.0',
        granted: true,
        granted_at: nowDate(),
        revoked_at: null,
        ip_address: null,
      }),
    );
    await this.dataAccessLog.recordConsentEvent(
      userId,
      SKIN_PROGRESS_CONSENT,
      UserDataAccessEventType.ConsentGranted,
      UserDataAccessPurpose.ConsentGrant,
    );
  }

  private async recordDataAccess(
    userId: string,
    purpose: UserDataAccessPurpose,
    actorType: UserDataAccessActorType = UserDataAccessActorType.User,
  ): Promise<void> {
    await this.dataAccessLog.recordDataAccess(
      userId,
      [SKIN_PROGRESS_CONSENT],
      purpose,
      actorType,
    );
  }

  private async evaluateCompletedAnalysis(
    userId: string,
    entry: SkinJournalEntry,
    obs: AnalysisObservations,
  ): Promise<void> {
    if (obs.reaction_signals.reaction_detected) {
      const existingReactionEvent = await this.findExistingEvent(
        userId,
        entry.id,
        'reaction_detected',
      );
      const event =
        existingReactionEvent ??
        (await this.recordEvent(userId, entry.id, {
          kind: 'reaction_detected',
          severity:
            obs.reaction_signals.reaction_severity === 'severe'
              ? 'critical'
              : 'warning',
          payload: {
            indicators: obs.reaction_signals.indicators,
            reaction_severity: obs.reaction_signals.reaction_severity,
            confidence: obs.reaction_signals.confidence,
          },
        }));
      if (!existingReactionEvent) {
        await this.dispatchNotification({
          userId,
          kind: 'reaction_detected',
          titleKey: NOTIFICATION_KEYS.reactionTitle,
          bodyKey: NOTIFICATION_KEYS.reactionBody,
          severity: event.severity === 'critical' ? 'critical' : 'warning',
          payload: { event_id: event.id, entry_id: entry.id },
          deepLink: `/journal/days/${entry.entry_date}`,
        });
      }

      if (
        ['moderate', 'severe'].includes(
          obs.reaction_signals.reaction_severity,
        ) &&
        obs.reaction_signals.confidence >= 0.6
      ) {
        const hadActiveSimplification =
          await this.hasActiveSimplification(userId);
        const simplification = await this.startSimplification({
          userId,
          triggeredByEventId: event.id,
          reason:
            'Journal-only barrier-repair safety state triggered by moderate or severe reaction signals.',
        });
        if (!hadActiveSimplification) {
          await this.dispatchNotification({
            userId,
            kind: 'simplification_started',
            titleKey: NOTIFICATION_KEYS.simplificationTitle,
            bodyKey: NOTIFICATION_KEYS.simplificationBody,
            severity: event.severity === 'critical' ? 'critical' : 'warning',
            payload: {
              simplification_id: simplification.id,
              event_id: event.id,
            },
            deepLink: `/journal/simplification/${simplification.id}`,
          });
        }
      }
    }

    await this.evaluateTrendEvents(userId, entry);
    await this.evaluateReferralThreshold(userId, entry, obs);
    await this.markInsightsAfterJournalChange(
      userId,
      'photo_analysis_completed',
    );
  }

  private async findExistingEvent(
    userId: string,
    entryId: string,
    kind: EventKind,
  ): Promise<SkinJournalEvent | null> {
    return this.events.findOne({
      where: {
        user_id: userId,
        entry_id: entryId,
        kind,
      },
    });
  }

  private async hasActiveSimplification(userId: string): Promise<boolean> {
    const existing = await this.simplifications.findOne({
      where: { user_id: userId, ended_at: IsNull() },
    });
    return !!existing;
  }

  private async markInsightsAfterJournalChange(
    userId: string,
    trigger: InsightGenerationTrigger,
  ): Promise<void> {
    try {
      await this.markInsightInputsDirty(userId, trigger);
    } catch (error) {
      this.logger.warn(
        `Insight inputs could not be marked dirty after ${trigger}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  async markProductOrRoutineInsightsDirty(userId: string): Promise<void> {
    await this.markInsightsAfterJournalChange(
      userId,
      'product_or_routine_changed',
    );
  }

  private async markInsightInputsDirty(
    userId: string,
    reason: InsightGenerationTrigger,
  ): Promise<void> {
    const snapshot = await this.buildInsightInputSnapshot(userId);
    const current = await this.insightStates.findOne({
      where: { user_id: userId },
    });
    const state =
      current ??
      this.insightStates.create({
        user_id: userId,
        dirty_since: null,
        dirty_reasons: [],
        last_generated_signature: null,
        last_generated_at: null,
        last_generation_trigger: null,
      });
    const dirtyReasons = new Set<InsightGenerationTrigger>(
      state.dirty_reasons ?? [],
    );
    dirtyReasons.add(reason);
    state.latest_input_signature = snapshot?.signature ?? null;
    state.latest_entry_count = snapshot?.entryCount ?? 0;
    state.last_checked_at = null;

    if (!snapshot?.signature) {
      state.dirty_since = null;
      state.dirty_reasons = [];
    } else if (state.last_generated_signature === snapshot.signature) {
      state.dirty_since = null;
      state.dirty_reasons = [];
    } else {
      state.dirty_since = state.dirty_since ?? nowDate();
      state.dirty_reasons = [...dirtyReasons];
    }

    await this.insightStates.save(state);
  }

  private async markInsightGenerationCompleted(
    userId: string,
    inputSignature: string,
    trigger: InsightGenerationTrigger,
  ): Promise<void> {
    const snapshot = await this.buildInsightInputSnapshot(userId);
    const current = await this.insightStates.findOne({
      where: { user_id: userId },
    });
    const state =
      current ??
      this.insightStates.create({
        user_id: userId,
        latest_input_signature: snapshot?.signature ?? inputSignature,
        latest_entry_count: snapshot?.entryCount ?? 0,
      });
    state.dirty_since =
      snapshot?.signature === inputSignature
        ? null
        : (state.dirty_since ?? nowDate());
    state.dirty_reasons =
      snapshot?.signature === inputSignature ? [] : (state.dirty_reasons ?? []);
    state.latest_input_signature = snapshot?.signature ?? inputSignature;
    state.latest_entry_count = snapshot?.entryCount ?? 0;
    state.last_generated_signature = inputSignature;
    state.last_generated_at = nowDate();
    state.last_generation_trigger = trigger;
    state.last_failed_signature = null;
    state.last_failed_at = null;
    state.last_checked_at = nowDate();
    await this.insightStates.save(state);
  }

  private async markInsightGenerationFailed(
    userId: string,
    inputSignature: string,
  ): Promise<void> {
    const current = await this.insightStates.findOne({
      where: { user_id: userId },
    });
    const state =
      current ??
      this.insightStates.create({
        user_id: userId,
        dirty_since: nowDate(),
        dirty_reasons: ['scheduled_refresh'],
      });
    state.last_failed_signature = inputSignature;
    state.last_failed_at = nowDate();
    state.last_checked_at = nowDate();
    await this.insightStates.save(state);
  }

  private async evaluateTrendEvents(
    userId: string,
    currentEntry: SkinJournalEntry,
  ): Promise<void> {
    const windowStart = new Date(`${currentEntry.entry_date}T00:00:00.000Z`);
    windowStart.setUTCDate(windowStart.getUTCDate() - 30);
    const recentEntries = await this.entries.find({
      where: {
        user_id: userId,
        entry_date: Between(
          windowStart.toISOString().slice(0, 10),
          currentEntry.entry_date,
        ),
      },
      order: { entry_date: 'ASC' },
      take: 31,
    });
    const previousEntry = recentEntries
      .filter((entry) => entry.id !== currentEntry.id)
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date))[0];
    if (!previousEntry) {
      return;
    }

    const worsening = strongestWorsening(previousEntry, currentEntry);
    if (worsening) {
      await this.recordEventOnce(userId, currentEntry.id, {
        kind: 'worsening',
        severity: 'warning',
        payload: worsening,
      });
    }

    if (
      isModerateOrSevereReaction(previousEntry.analysis_observations) &&
      currentEntry.analysis_observations?.reaction_signals.reaction_detected ===
        false
    ) {
      await this.recordEventOnce(userId, currentEntry.id, {
        kind: 'recovery',
        severity: 'info',
        payload: {
          previous_entry_id: previousEntry.id,
          previous_entry_date: previousEntry.entry_date,
          recovered_on: currentEntry.entry_date,
        },
      });
    }
  }

  private async evaluateReferralThreshold(
    userId: string,
    entry: SkinJournalEntry,
    obs: AnalysisObservations,
  ): Promise<void> {
    const entryDate = entry.entry_date;
    const start = new Date(`${entryDate}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    const recentEntries = await this.entries.find({
      where: {
        user_id: userId,
        entry_date: Between(start.toISOString().slice(0, 10), entryDate),
      },
    });
    const moderateOrSevere = recentEntries.filter((entry) =>
      isModerateOrSevereReaction(entry.analysis_observations),
    );
    const doctorFlags = recentEntries.filter(
      (entry) => entry.analysis_observations?.should_flag_for_doctor === true,
    );
    const shouldRefer =
      moderateOrSevere.length >= 5 ||
      doctorFlags.length >= 3 ||
      (obs.should_flag_for_doctor && obs.reaction_signals.confidence >= 0.6);
    if (!shouldRefer) {
      return;
    }

    const event = await this.recordEventOnce(userId, entry.id, {
      kind: 'dermatologist_referral',
      severity: 'critical',
      payload: {
        moderate_or_severe_count_7d: moderateOrSevere.length,
        doctor_flag_count_7d: doctorFlags.length,
      },
    });
    if (!event) {
      return;
    }
    await this.dispatchNotification({
      userId,
      kind: 'doctor_referral',
      titleKey: NOTIFICATION_KEYS.referralTitle,
      bodyKey: NOTIFICATION_KEYS.referralBody,
      severity: 'critical',
      payload: { event_id: event.id },
      deepLink: '/journal?tab=insights',
    });
  }

  private normalizeUpsertBody(body: UpsertEntryDto): UpsertEntryDto {
    return normalizeUpsertEntryBody(body);
  }

  private validateOptionalDateRange(filters: {
    from?: string;
    to?: string;
  }): void {
    if (filters.from && !isValidDate(filters.from)) {
      throw new BadRequestException('Invalid from date');
    }
    if (filters.to && !isValidDate(filters.to)) {
      throw new BadRequestException('Invalid to date');
    }
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new BadRequestException('Date range must start before it ends');
    }
  }

  private buildPhotoEntryWhere(
    userId: string,
    filters: { from?: string; to?: string },
  ): FindOptionsWhere<SkinJournalEntry> {
    const where: FindOptionsWhere<SkinJournalEntry> = {
      user_id: userId,
      photo_object_key: Not(IsNull()),
    };
    if (filters.from && filters.to) {
      where.entry_date = Between(filters.from, filters.to);
    } else if (filters.from) {
      where.entry_date = MoreThanOrEqual(filters.from);
    } else if (filters.to) {
      where.entry_date = LessThanOrEqual(filters.to);
    }
    return where;
  }

  private parsePhotoFilter(filter: string | undefined): ParsedPhotoFilter {
    if (!filter || filter === PHOTO_FILTER_ALL_ID) {
      return { id: PHOTO_FILTER_ALL_ID, kind: 'all' };
    }
    if (filter === PHOTO_FILTER_REACTION_ID) {
      return { id: PHOTO_FILTER_REACTION_ID, kind: 'reaction' };
    }
    if (filter.startsWith(PHOTO_FILTER_CONCERN_PREFIX)) {
      const value = filter.slice(PHOTO_FILTER_CONCERN_PREFIX.length);
      if (ANALYSIS_CONCERN_SET.has(value as AnalysisConcern)) {
        return {
          id: filter,
          kind: 'concern',
          value: value as AnalysisConcern,
        };
      }
    }
    throw new BadRequestException('Invalid photo filter');
  }

  private applyPhotoDateFilters(
    queryBuilder: SelectQueryBuilder<SkinJournalEntry>,
    filters: { from?: string; to?: string },
  ): void {
    if (filters.from) {
      queryBuilder.andWhere('entry.entry_date >= :from', {
        from: filters.from,
      });
    }
    if (filters.to) {
      queryBuilder.andWhere('entry.entry_date <= :to', { to: filters.to });
    }
  }

  private applyPhotoFilter(
    queryBuilder: SelectQueryBuilder<SkinJournalEntry>,
    filter: ParsedPhotoFilter,
  ): void {
    if (filter.kind === 'all') {
      return;
    }
    if (filter.kind === 'reaction') {
      queryBuilder.andWhere('entry.has_reaction_signal = true');
      return;
    }
    queryBuilder.andWhere(':concern = ANY(entry.analysis_concern_keys)', {
      concern: filter.value,
    });
  }

  private applyPhotoCursor(
    queryBuilder: SelectQueryBuilder<SkinJournalEntry>,
    cursor: string | undefined,
    fingerprint: string,
  ): void {
    if (!cursor) {
      return;
    }
    const decoded = decodeCursor(cursor);
    if (decoded.fingerprint !== fingerprint) {
      throw new BadRequestException('Cursor does not match this request');
    }
    const [entryDate, id] = decoded.tuple;
    if (typeof entryDate !== 'string' || typeof id !== 'string') {
      throw new BadRequestException('Invalid cursor');
    }
    queryBuilder.andWhere(
      new Brackets((qb) => {
        qb.where('entry.entry_date < :cursorEntryDate', {
          cursorEntryDate: entryDate,
        }).orWhere(
          'entry.entry_date = :cursorEntryDate AND entry.id < :cursorId',
          { cursorEntryDate: entryDate, cursorId: id },
        );
      }),
    );
  }

  private buildPhotoNextCursor(
    item: SkinJournalEntry | undefined,
    fingerprint: string,
    hasMore: boolean,
  ): string | null {
    if (!hasMore || !item) {
      return null;
    }
    return encodeCursor({
      fingerprint,
      tuple: [item.entry_date, item.id],
    });
  }

  private validateDateRange(from: string, to: string): void {
    if (!isValidDate(from) || !isValidDate(to)) {
      throw new BadRequestException('Invalid date range');
    }
    if (from > to) {
      throw new BadRequestException('Date range must start before it ends');
    }
  }

  private async dispatchNotification(params: {
    userId: string;
    kind: NotificationKind;
    titleKey: string;
    bodyKey: string;
    severity?: NotificationSeverity;
    payload?: Record<string, unknown>;
    deepLink?: string;
  }): Promise<void> {
    await this.notifications.dispatch(params);
  }

  private strongestNotificationSeverity(
    left: NotificationSeverity,
    right: NotificationSeverity,
  ): NotificationSeverity {
    const rank: Record<NotificationSeverity, number> = {
      info: 0,
      warning: 1,
      critical: 2,
    };
    return rank[right] > rank[left] ? right : left;
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function photoCursorFingerprint(
  userId: string,
  filters: { from?: string; to?: string; filter?: string },
  parsedFilter: ParsedPhotoFilter,
): string {
  return [
    'skin-journal-photos-v1',
    userId,
    filters.from ?? '',
    filters.to ?? '',
    parsedFilter.id,
  ].join(':');
}

function hasAiNoFaceSignal(obs: AnalysisObservations): boolean {
  return (
    obs.image_quality.face_detected === false ||
    obs.image_quality.issues.includes('non_face_image') ||
    (obs.per_angle_quality ?? []).some(
      (quality) =>
        quality.face_detected === false ||
        quality.issues.includes('non_face_image'),
    )
  );
}

function firstCompareQualityLimitation(
  from: SkinJournalEntry,
  to: SkinJournalEntry,
): PhotoReferenceQualityReason | null {
  if (!from.analysis_observations && !to.analysis_observations) {
    return null;
  }
  const fromQuality = buildPhotoReferenceQuality(from);
  const toQuality = buildPhotoReferenceQuality(to);
  if (fromQuality.status === 'not_trend_safe') {
    return fromQuality.reasons[0] ?? 'not_comparable';
  }
  if (toQuality.status === 'not_trend_safe') {
    return toQuality.reasons[0] ?? 'not_comparable';
  }
  return null;
}

function analysisConcernMap(observations: AnalysisObservations | null): Map<
  AnalysisConcern,
  {
    severity: Exclude<CompareDeltaSeverity, 'none'>;
    confidence: number;
  }
> {
  const concerns = new Map<
    AnalysisConcern,
    {
      severity: Exclude<CompareDeltaSeverity, 'none'>;
      confidence: number;
    }
  >();
  for (const concern of observations?.detected_concerns ?? []) {
    if (concern.confidence < 0.55) {
      continue;
    }
    const existing = concerns.get(concern.concern);
    if (
      !existing ||
      severityRank(concern.severity) > severityRank(existing.severity) ||
      concern.confidence > existing.confidence
    ) {
      concerns.set(concern.concern, {
        severity: concern.severity,
        confidence: concern.confidence,
      });
    }
  }
  return concerns;
}

function reactionSeverity(entry: SkinJournalEntry): CompareDeltaSeverity {
  const reaction = entry.analysis_observations?.reaction_signals;
  if (!reaction?.reaction_detected && !entry.has_reaction_signal) {
    return 'none';
  }
  return reaction?.reaction_severity ?? 'moderate';
}

function severityRank(severity: CompareDeltaSeverity): number {
  return {
    none: 0,
    mild: 1,
    moderate: 2,
    severe: 3,
  }[severity];
}

function normalizeInsightCadence(value: unknown): InsightCadence {
  return value === 'fewer' || value === 'weekly'
    ? value
    : INSIGHT_CADENCE_DEFAULT;
}

function normalizeInsightDigestDay(value: unknown): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 7
    ? value
    : INSIGHT_DIGEST_DAY_DEFAULT;
}

function normalizeInsightDigestLocalTime(value: unknown): string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d/.test(value)
    ? value.slice(0, 5)
    : INSIGHT_DIGEST_LOCAL_TIME_DEFAULT;
}

function isInsightDigestWindowOpen(
  now: Date,
  cadence: InsightCadenceSettings,
): boolean {
  if (isoDayInTimeZone(now, cadence.timeZone) !== cadence.digestDay) {
    return false;
  }
  return (
    minutesInTimeZone(now, cadence.timeZone) >=
    parseClockMinutes(cadence.digestLocalTime)
  );
}

function isoDayInTimeZone(now: Date, timeZone: string): number {
  const shortDay = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(now);
  const dayByName: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return dayByName[shortDay] ?? 1;
}

function minutesInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? 0,
  );
  return hour * 60 + minute;
}

function parseClockMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === '23505';
}

function sanitizeContextText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, ANALYSIS_CONTEXT_MAX_TEXT_LENGTH);
}

function sanitizeStringArray(
  values: readonly string[] | null | undefined,
): string[] {
  const safeValues: readonly unknown[] = Array.isArray(values) ? values : [];
  return safeValues
    .map((value) =>
      typeof value === 'string' ? sanitizeContextText(value) : null,
    )
    .filter((value): value is string => value !== null)
    .slice(0, ANALYSIS_CONTEXT_MAX_ITEMS);
}

function sanitizeConcernDetails(
  details: readonly ConcernDetail[],
): NonNullable<AnalysisSkinContext['concern_details']> {
  return details.slice(0, ANALYSIS_CONTEXT_MAX_ITEMS).map((detail) => ({
    concern: sanitizeContextText(detail.concern) ?? 'unknown',
    severity: sanitizeContextText(detail.severity),
    locations: sanitizeStringArray(detail.locations),
    subtype: sanitizeContextText(detail.subtype),
    priority:
      typeof detail.priority === 'number' && Number.isFinite(detail.priority)
        ? detail.priority
        : null,
  }));
}
