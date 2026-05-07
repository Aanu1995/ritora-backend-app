import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  OnModuleDestroy,
  OnModuleInit,
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
import { SkinJournalEvent } from './entities/skin-journal-event.entity';
import { SkinJournalInsight } from './entities/skin-journal-insight.entity';
import { SkinJournalInsightGenerationRun } from './entities/skin-journal-insight-generation-run.entity';
import { SkinJournalInsightJob } from './entities/skin-journal-insight-job.entity';
import { SkinJournalInsightState } from './entities/skin-journal-insight-state.entity';
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { SkinJournalAnalysisJob } from './entities/skin-journal-analysis-job.entity';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { SkinJournalExportJob } from './entities/skin-journal-export-job.entity';
import { SkinJournalPhotoStorageService } from './services/skin-journal-photo-storage.service';
import { SkinJournalAnalysisService } from './services/skin-journal-analysis.service';
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
import { JournalEntryResponseDto } from './dto/journal-entry-response.dto';
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
  RatingsPayload,
  SKIN_JOURNAL_ANALYSIS_CAPACITY_RETRY_DELAY_MS,
  SKIN_JOURNAL_ANALYSIS_FAILURE_RATE_ALERT_THRESHOLD,
  SKIN_JOURNAL_ANALYSIS_QUEUE_AGE_ALERT_SECONDS,
  SKIN_JOURNAL_ANALYSIS_RECOVERY_INTERVAL_MS,
  SKIN_JOURNAL_INSIGHT_PATTERN_CARDS_ENABLED,
  SKIN_JOURNAL_INSIGHT_FAILED_RETRY_COOLDOWN_DAYS,
  SKIN_JOURNAL_INSIGHT_MIN_ENTRIES_FOR_PERIODIC_GENERATION,
  SKIN_JOURNAL_INSIGHT_PERIODIC_INTERVAL_DAYS,
  SKIN_JOURNAL_INSIGHT_SUMMARY_CARDS_ENABLED,
  SKIN_JOURNAL_PHOTO_PAGE_DEFAULT_LIMIT,
  SKIN_JOURNAL_PHOTO_PAGE_MAX_LIMIT,
  SKIN_JOURNAL_WRAPPED_ENABLED,
  SkinJournalExportPayload,
  AnalysisStatus,
  AnalysisStatusValue,
  AnalysisEntryContext,
  AnalysisSkinContext,
  CompareDeltaBullet,
  ExportStatusValue,
  InsightGenerationStatusValue,
} from './skin-journal.constants';
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
import { InsightPolishService } from './insights/insight-polish.service';
import { KnowledgeBaseService } from './insights/knowledge-base/knowledge-base.service';
import type { InsightBlock, InsightCandidate } from './insights/insight-types';

interface InsightEntryPreview {
  entry_id: string;
  date: string;
  photo_url: string | null;
}

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
    @InjectRepository(SkinJournalEvent)
    private readonly events: Repository<SkinJournalEvent>,
    @InjectRepository(SkinJournalInsight)
    private readonly insights: Repository<SkinJournalInsight>,
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

  async upsertEntryForResolvedDate(params: {
    userId: string;
    targetDate: string;
    timeZone: string;
    photo?: { buffer: Buffer; contentType: string } | null;
    body: UpsertEntryDto;
  }): Promise<JournalEntryResponseDto> {
    const body = this.normalizeUpsertBody(params.body);
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

    let previousPhotoObjectKey: string | null = null;
    let storedPhotoObjectKey: string | null = null;
    if (params.photo) {
      await this.ensureSkinProgressConsent(
        params.userId,
        body.photo_processing_consent === true,
      );
      previousPhotoObjectKey = entry.photo_object_key;
      const stored = await this.photoStorage.storePhoto({
        userId: params.userId,
        entryId: entry.id,
        buffer: params.photo.buffer,
        contentType: params.photo.contentType,
      });
      storedPhotoObjectKey = stored.object_key;
      entry.photo_object_key = stored.object_key;
      entry.photo_size = stored.size;
      entry.photo_content_type = stored.content_type;
      entry.photo_width = stored.width;
      entry.photo_height = stored.height;
      entry.exif_stripped = stored.exif_stripped;

      /* Re-analyse on photo replacement. */
      entry.analysis_status = AnalysisStatusValue.Pending;
      entry.analysis_observations = null;
      entry.analysis_interpretation = null;
      entry.analysis_concern_keys = [];
      entry.has_reaction_signal = false;
      entry.needs_retake = false;
      entry.analysis_summary = null;
      entry.analysis_completed_at = null;
      entry.analysis_error = null;
    }

    if (!entry.photo_object_key) {
      entry.analysis_status = AnalysisStatusValue.Skipped;
    }

    let saved: SkinJournalEntry;
    try {
      saved = await this.entries.save(entry);
    } catch (error) {
      if (
        storedPhotoObjectKey &&
        storedPhotoObjectKey !== previousPhotoObjectKey
      ) {
        await this.deletePhotoBestEffort(
          storedPhotoObjectKey,
          params.userId,
          'entry_save_failed_after_photo_upload',
        );
      }
      throw error;
    }

    if (
      previousPhotoObjectKey &&
      previousPhotoObjectKey !== saved.photo_object_key
    ) {
      await this.analysisQueue.cancelActiveJobsForEntry(
        saved.id,
        'Photo was replaced before this analysis job ran.',
      );
      await this.clearEntryAnalysisArtifacts(params.userId, saved.id);
      await this.deletePhotoBestEffort(
        previousPhotoObjectKey,
        params.userId,
        'photo_replaced',
      );
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

    return JournalEntryResponseDto.fromEntity(
      saved,
      this.photoStorage.getSignedUrl(saved.photo_object_key),
    );
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
    return JournalEntryResponseDto.fromEntity(
      refreshed,
      this.photoStorage.getSignedUrl(refreshed.photo_object_key),
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
        ? JournalEntryResponseDto.fromEntity(
            entry,
            this.photoStorage.getSignedUrl(entry.photo_object_key),
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
      entryDto = JournalEntryResponseDto.fromEntity(
        entry,
        this.photoStorage.getSignedUrl(entry.photo_object_key),
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
    return entries.map((entry) =>
      JournalEntryResponseDto.fromEntity(
        entry,
        this.photoStorage.getSignedUrl(entry.photo_object_key),
      ),
    );
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
      items: page.map((entry) =>
        JournalEntryResponseDto.fromEntity(
          entry,
          this.photoStorage.getSignedUrl(entry.photo_object_key),
        ),
      ),
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
    return {
      from: JournalEntryResponseDto.fromEntity(
        from,
        this.photoStorage.getSignedUrl(from.photo_object_key),
      ),
      to: JournalEntryResponseDto.fromEntity(
        to,
        this.photoStorage.getSignedUrl(to.photo_object_key),
      ),
      delta: this.computeDelta(from, to),
    };
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const entry = await this.findOwnedEntry(userId, entryId);
    this.assertEntryIsEditableToday(entry);
    await this.analysisQueue.cancelActiveJobsForEntry(
      entry.id,
      'Journal entry was deleted.',
    );
    await this.entries.delete({ id: entry.id });
    await this.clearEntryAnalysisArtifacts(userId, entry.id);
    if (entry.photo_object_key) {
      await this.deletePhotoBestEffort(
        entry.photo_object_key,
        userId,
        'entry_deleted',
      );
    }
    await this.markInsightsAfterJournalChange(userId, 'entry_deleted');
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
      photo: null,
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

    const photoObjectKey = expectedPhotoObjectKey ?? entry.photo_object_key;
    if (entry.photo_object_key !== photoObjectKey) {
      if (job) {
        await this.analysisQueue.cancelJob(
          job,
          'Photo was replaced before this analysis job ran.',
        );
      }
      return;
    }
    const startedAt = nowDate();
    const fallbackStartedAt = Date.now();
    let plannedInputImageCount = 1;
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
      plannedInputImageCount = previousEntry?.photo_object_key ? 2 : 1;
      const result = await this.analysis.analyze({
        userId,
        entryId: entry.id,
        photoObjectKey,
        priorPhotoObjectKey: previousEntry?.photo_object_key ?? null,
        concernFocus: entry.concern_focus,
        priorAnalysis: previousEntry?.analysis_observations ?? null,
        skinContext,
        entryContext: this.buildAnalysisEntryContext(entry),
      });
      const obs = result.observations;

      const current = await this.entries.findOne({
        where: { id: entryId, user_id: userId },
      });
      if (!current || current.photo_object_key !== photoObjectKey) {
        if (job) {
          await this.analysisQueue.cancelJob(
            job,
            'Photo was replaced before completed analysis could be saved.',
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
      await this.entries.save(current);

      await this.evaluateCompletedAnalysis(userId, current, obs);
      if (job) {
        await this.analysisQueue.completeJob(job);
      }
    } catch (err) {
      const current = await this.entries.findOne({
        where: { id: entryId, user_id: userId },
      });
      if (!current || current.photo_object_key !== photoObjectKey) {
        if (job) {
          await this.analysisQueue.cancelJob(
            job,
            'Photo was replaced before failed analysis could be recorded.',
          );
        }
        return;
      }
      const errorMessage =
        err instanceof Error ? err.message : 'Analysis failed';
      const shouldRetry =
        !!job &&
        job.attempt_count <
          (job.max_attempts || this.analysisQueue.getMaxAttempts());
      if (shouldRetry && job) {
        current.analysis_status = AnalysisStatusValue.Queued;
        current.analysis_error = errorMessage;
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
      current.analysis_prompt_version = this.analysis.promptVersion();
      current.analysis_started_at = startedAt;
      current.analysis_duration_ms = Date.now() - fallbackStartedAt;
      current.analysis_input_image_count = plannedInputImageCount;
      await this.entries.save(current);
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
    analysis: {
      window_hours: number;
      completed_count: number;
      failed_count: number;
      needs_review_count: number;
      average_duration_ms: number | null;
      failure_rate: number;
      retake_rate: number;
      safety_flag_rate: number;
      estimated_cost_usd: number;
      total_tokens: number;
    };
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
    const denominator = Math.max(1, analysedEntries.length);
    const retakeCount = analysedEntries.filter(
      (entry) => entry.analysis_observations?.image_quality?.needs_retake,
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

    return {
      queue,
      analysis: {
        window_hours: windowHours,
        completed_count: completedCount,
        failed_count: failedCount,
        needs_review_count: needsReviewCount,
        average_duration_ms: averageDuration,
        failure_rate: failureRate,
        retake_rate: retakeCount / denominator,
        safety_flag_rate: safetyFlagCount / denominator,
        estimated_cost_usd: estimatedCost,
        total_tokens: totalTokens,
      },
      alerts,
    };
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
    insight.dismissed_at = new Date();
    await this.insights.save(insight);
  }

  async markInsightSeen(userId: string, insightId: string): Promise<void> {
    const insight = await this.insights.findOne({
      where: { id: insightId, user_id: userId },
    });
    if (!insight) return;
    if (!insight.seen_at) {
      insight.seen_at = new Date();
      await this.insights.save(insight);
    }
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
    const activeJob = await this.insightQueue.getActiveJobForUser(userId);
    if (activeJob) {
      await this.updateInsightStateAfterSchedulerCheck(
        userId,
        snapshot.signature,
        snapshot.entryCount,
      );
      return false;
    }

    if (!this.shouldQueuePeriodicInsightGeneration(state, snapshot)) {
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
      nextEligibleAt.getUTCDate() + SKIN_JOURNAL_INSIGHT_PERIODIC_INTERVAL_DAYS,
    );
    return nextEligibleAt.getTime() <= Date.now();
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
    const normalizedEntryCount = Math.max(entryCount, recentEntries.length);
    return {
      signature: this.hashInsightInputs(recentEntries),
      entryCount: normalizedEntryCount,
    };
  }

  private hashInsightInputs(entries: SkinJournalEntry[]): string {
    const payload = [...entries]
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
        completed_at: null,
        error: null,
      }),
    );

    try {
      const preferences = await this.notifications.getPreferences(userId);
      const aiPolishEnabled =
        preferences.ai_polished_insights_enabled !== false;
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
      });
      const polished = await this.insightPolish.polish(candidates, {
        locale: options.locale ?? 'en',
        aiPolishEnabled,
      });

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
    const [entries, wrapped] = await Promise.all([
      this.entries.find({ where: { user_id: userId } }),
      this.wrapped.find({ where: { user_id: userId } }),
    ]);
    const objectKeys = [
      ...entries
        .map((entry) => entry.photo_object_key)
        .filter((key): key is string => typeof key === 'string' && !!key),
      ...wrapped
        .map((wrapped) => wrapped.media_object_key)
        .filter((key): key is string => typeof key === 'string' && !!key),
    ];
    for (const objectKey of objectKeys) {
      await this.deletePhotoBestEffort(
        objectKey,
        userId,
        'account_media_deleted',
      );
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
    return (
      candidates.find(
        (candidate) =>
          candidate.id !== currentEntry.id &&
          candidate.entry_date < currentEntry.entry_date &&
          !!candidate.photo_object_key &&
          isTrendSafeBaseline(candidate.analysis_observations),
      ) ?? null
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
    return {
      generated_at: new Date().toISOString(),
      from,
      to,
      entries: entries.map((entry) => toExportEntryRecord(entry)),
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
    if (
      (from.has_reaction_signal ||
        from.analysis_observations?.reaction_signals?.reaction_detected) &&
      !(
        to.has_reaction_signal ||
        to.analysis_observations?.reaction_signals?.reaction_detected
      )
    ) {
      bullets.push({ code: 'reaction_cleared', tone: 'good' });
    }
    if (bullets.length === 0) {
      bullets.push({ code: 'no_major_change', tone: 'neutral' });
    }
    return { bullets };
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

function isTrendSafeBaseline(obs: AnalysisObservations | null): boolean {
  if (!obs) {
    return false;
  }
  return (
    obs.image_quality.face_detected === true &&
    obs.image_quality.needs_retake !== true &&
    obs.image_quality.excluded_from_trends_reason == null
  );
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
