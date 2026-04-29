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
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  In,
  IsNull,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { nowDate } from '../common/utils/date';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  NotificationKind,
  NotificationSeverity,
} from '../notifications/entities/in-app-notification.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
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
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { SkinJournalExportJob } from './entities/skin-journal-export-job.entity';
import { SkinJournalPhotoStorageService } from './services/skin-journal-photo-storage.service';
import { SkinJournalAnalysisService } from './services/skin-journal-analysis.service';
import { UpsertEntryDto } from './dto/upsert-entry.dto';
import {
  CreateJournalExportDto,
  JournalExportResponseDto,
} from './dto/export-journal.dto';
import {
  CalendarDayDto,
  CalendarDayState,
  CalendarResponseDto,
} from './dto/calendar-response.dto';
import { JournalEntryResponseDto } from './dto/journal-entry-response.dto';
import { DayDetailResponseDto } from './dto/day-detail-response.dto';
import { JournalEventResponseDto } from './dto/event-response.dto';
import { JournalInsightResponseDto } from './dto/insight-response.dto';
import { JournalStatsResponseDto } from './dto/stats-response.dto';
import { WrappedResponseDto } from './dto/wrapped-response.dto';
import { SimplificationResponseDto } from './dto/simplification-response.dto';
import {
  AnalysisObservations,
  CONCERN_KEYS,
  EventKind,
  InsightKind,
  RatingsPayload,
  SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD,
  SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT,
  SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT_PER_USER,
  SKIN_JOURNAL_WRAPPED_ENABLED,
  SkinJournalExportPayload,
  AnalysisStatus,
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
const ANALYSIS_QUEUE_RETRY_DELAY_MS = 5000;
const ANALYSIS_BUDGET_RETRY_GRACE_MS = 60_000;

type QueuedAnalysisRun = {
  userId: string;
  entryId: string;
  photoObjectKey: string;
  notBefore: number;
};

@Injectable()
export class SkinJournalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkinJournalService.name);
  private readonly analysisInFlight = new Set<string>();
  private readonly perUserAnalysisInFlight = new Map<string, number>();
  private readonly analysisBudgetCounters = new Map<
    string,
    { date: string; count: number }
  >();
  private readonly queuedAnalysisRuns = new Map<string, QueuedAnalysisRun>();
  private analysisQueueTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @InjectRepository(SkinJournalEntry)
    private readonly entries: Repository<SkinJournalEntry>,
    @InjectRepository(SkinJournalEvent)
    private readonly events: Repository<SkinJournalEvent>,
    @InjectRepository(SkinJournalInsight)
    private readonly insights: Repository<SkinJournalInsight>,
    @InjectRepository(SkinJournalWrapped)
    private readonly wrapped: Repository<SkinJournalWrapped>,
    @InjectRepository(RoutineSimplificationEvent)
    private readonly simplifications: Repository<RoutineSimplificationEvent>,
    @InjectRepository(SkinJournalExportJob)
    private readonly exportJobs: Repository<SkinJournalExportJob>,
    @InjectRepository(UserConsent)
    private readonly consents: Repository<UserConsent>,
    private readonly photoStorage: SkinJournalPhotoStorageService,
    private readonly analysis: SkinJournalAnalysisService,
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
  }

  onModuleDestroy(): void {
    if (this.analysisQueueTimer) {
      clearTimeout(this.analysisQueueTimer);
      this.analysisQueueTimer = null;
    }
    this.queuedAnalysisRuns.clear();
    this.analysisInFlight.clear();
    this.perUserAnalysisInFlight.clear();
  }

  // ---------- ENTRY UPSERT ----------

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
    if (params.targetDate > today) {
      throw new BadRequestException('Cannot create entries for future dates');
    }

    let entry = await this.entries.findOne({
      where: { user_id: params.userId, entry_date: params.targetDate },
    });

    if (!entry) {
      entry = this.entries.create({
        user_id: params.userId,
        entry_date: params.targetDate,
        time_zone: timeZone,
        analysis_status: 'pending',
      });
    }

    if (body.angle) entry.angle = body.angle;
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
      entry.analysis_status = 'pending';
      entry.analysis_observations = null;
      entry.analysis_summary = null;
      entry.analysis_completed_at = null;
      entry.analysis_error = null;
    }

    if (!entry.photo_object_key) {
      entry.analysis_status = 'skipped';
    }

    let saved: SkinJournalEntry;
    try {
      saved = await this.entries.save(entry);
    } catch (error) {
      if (
        storedPhotoObjectKey &&
        storedPhotoObjectKey !== previousPhotoObjectKey
      ) {
        await this.deletePhotoBestEffort(storedPhotoObjectKey);
      }
      throw error;
    }

    if (
      previousPhotoObjectKey &&
      previousPhotoObjectKey !== saved.photo_object_key
    ) {
      this.removeQueuedAnalysisRunsForEntry(saved.id);
      await this.clearEntryAnalysisArtifacts(params.userId, saved.id);
      await this.deletePhotoBestEffort(previousPhotoObjectKey);
    }

    if (saved.analysis_status === 'pending' && saved.photo_object_key) {
      void this.runAnalysis(
        saved.id,
        params.userId,
        saved.photo_object_key,
      ).catch((err) =>
        this.logger.error(`Analysis failed for ${saved.id}`, err),
      );
    }

    return JournalEntryResponseDto.fromEntity(
      saved,
      this.photoStorage.getSignedUrl(saved.photo_object_key),
    );
  }

  private async deletePhotoBestEffort(objectKey: string): Promise<void> {
    try {
      await this.photoStorage.deletePhoto(objectKey);
    } catch (error) {
      this.logger.warn(
        `Failed to clean up photo ${objectKey}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  async retryAnalysis(
    userId: string,
    entryId: string,
  ): Promise<JournalEntryResponseDto> {
    const entry = await this.findOwnedEntry(userId, entryId);
    if (!entry.photo_object_key) {
      throw new BadRequestException('Entry has no photo to analyse');
    }
    entry.analysis_status = 'pending';
    entry.analysis_error = null;
    entry.analysis_retry_count = (entry.analysis_retry_count ?? 0) + 1;
    await this.entries.save(entry);
    this.removeQueuedAnalysisRunsForEntry(entry.id);
    await this.runAnalysis(entry.id, userId);
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
        (i) => !i.related_entry_ids || i.related_entry_ids.includes(entry.id),
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
      for (const id of i.related_entry_ids ?? []) {
        insightEntryIds.add(id);
      }
    }

    const days: CalendarDayDto[] = dates.map((date) => {
      const entry = byDate.get(date);
      let state: CalendarDayState = 'no_entry';
      let hasReaction = false;
      if (entry) {
        if (!entry.photo_object_key) {
          state = 'entry_no_photo';
        } else if (
          entry.analysis_status === 'pending' ||
          entry.analysis_status === 'queued' ||
          entry.analysis_status === 'running'
        ) {
          state = 'pending';
        } else if (entry.analysis_status === 'failed') {
          state = 'failed';
        } else {
          hasReaction =
            !!entry.analysis_observations?.reaction_signals?.reaction_detected;
          state = hasReaction ? 'reaction' : 'completed';
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
    filters: { from?: string; to?: string; hasReaction?: boolean },
  ): Promise<JournalEntryResponseDto[]> {
    if (filters.from && !isValidDate(filters.from)) {
      throw new BadRequestException('Invalid from date');
    }
    if (filters.to && !isValidDate(filters.to)) {
      throw new BadRequestException('Invalid to date');
    }
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new BadRequestException('Date range must start before it ends');
    }
    const start = filters.from ?? '2000-01-01';
    const end = filters.to ?? '2999-12-31';
    const list = await this.entries.find({
      where: { user_id: userId, entry_date: Between(start, end) },
      order: { entry_date: 'DESC' },
    });
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    const filtered = list.filter((e) => !!e.photo_object_key);
    const reactionFiltered =
      filters.hasReaction === true
        ? filtered.filter(
            (e) =>
              !!e.analysis_observations?.reaction_signals?.reaction_detected,
          )
        : filtered;
    return reactionFiltered.map((e) =>
      JournalEntryResponseDto.fromEntity(
        e,
        this.photoStorage.getSignedUrl(e.photo_object_key),
      ),
    );
  }

  async getCompare(
    userId: string,
    fromDate: string,
    toDate: string,
  ): Promise<{
    from: JournalEntryResponseDto | null;
    to: JournalEntryResponseDto | null;
    delta: {
      bullets: Array<{ text: string; tone: 'good' | 'warn' | 'neutral' }>;
    };
  }> {
    if (!isValidDate(fromDate) || !isValidDate(toDate)) {
      throw new BadRequestException('Invalid date');
    }
    const [from, to] = await Promise.all([
      this.entries.findOne({
        where: { user_id: userId, entry_date: fromDate },
      }),
      this.entries.findOne({
        where: { user_id: userId, entry_date: toDate },
      }),
    ]);
    await this.recordDataAccess(userId, UserDataAccessPurpose.SkinJournalRead);
    return {
      from: from
        ? JournalEntryResponseDto.fromEntity(
            from,
            this.photoStorage.getSignedUrl(from.photo_object_key),
          )
        : null,
      to: to
        ? JournalEntryResponseDto.fromEntity(
            to,
            this.photoStorage.getSignedUrl(to.photo_object_key),
          )
        : null,
      delta: this.computeDelta(from, to),
    };
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const entry = await this.findOwnedEntry(userId, entryId);
    this.removeQueuedAnalysisRunsForEntry(entry.id);
    await this.entries.delete({ id: entry.id });
    await this.clearEntryAnalysisArtifacts(userId, entry.id);
    if (entry.photo_object_key) {
      await this.deletePhotoBestEffort(entry.photo_object_key);
    }
  }

  async updateEntryById(
    userId: string,
    entryId: string,
    body: UpsertEntryDto,
  ): Promise<JournalEntryResponseDto> {
    const entry = await this.findOwnedEntry(userId, entryId);
    return this.upsertEntryForResolvedDate({
      userId,
      targetDate: entry.entry_date,
      timeZone: entry.time_zone,
      photo: null,
      body,
    });
  }

  // ---------- ANALYSIS ----------

  async runAnalysis(
    entryId: string,
    userId: string,
    expectedPhotoObjectKey?: string,
  ): Promise<void> {
    const entry = await this.entries.findOne({
      where: { id: entryId, user_id: userId },
    });
    if (!entry || !entry.photo_object_key) return;

    const photoObjectKey = expectedPhotoObjectKey ?? entry.photo_object_key;
    if (entry.photo_object_key !== photoObjectKey) {
      return;
    }
    const analysisKey = `${entry.id}:${photoObjectKey}`;
    if (this.analysisInFlight.has(analysisKey)) {
      return;
    }
    if (!this.tryAcquireAnalysisSlot(userId, analysisKey)) {
      await this.markAnalysisQueued(
        userId,
        entry.id,
        photoObjectKey,
        'Analysis queued because current analysis capacity is full.',
      );
      this.enqueueAnalysisRetry({
        userId,
        entryId: entry.id,
        photoObjectKey,
        notBefore: Date.now() + ANALYSIS_QUEUE_RETRY_DELAY_MS,
      });
      return;
    }
    if (!this.consumeAnalysisBudget(userId)) {
      this.releaseAnalysisSlot(userId, analysisKey);
      await this.markAnalysisQueued(
        userId,
        entry.id,
        photoObjectKey,
        'Analysis queued because the daily analysis budget has been reached.',
      );
      this.enqueueAnalysisRetry({
        userId,
        entryId: entry.id,
        photoObjectKey,
        notBefore: Date.now() + this.msUntilNextAnalysisBudgetWindow(),
      });
      return;
    }

    try {
      entry.analysis_status = 'running';
      await this.entries.save(entry);
      await this.recordDataAccess(
        userId,
        UserDataAccessPurpose.SkinPhotoAnalysis,
        UserDataAccessActorType.System,
      );
      const obs = await this.analysis.analyze({
        userId,
        entryId: entry.id,
        photoObjectKey,
        concernFocus: entry.concern_focus,
        priorAnalysis: null,
      });

      const current = await this.entries.findOne({
        where: { id: entryId, user_id: userId },
      });
      if (!current || current.photo_object_key !== photoObjectKey) {
        return;
      }

      current.analysis_observations = obs;
      current.analysis_summary = this.analysis.shortSummary(obs);
      current.analysis_status = obs.image_quality.face_detected
        ? 'completed'
        : 'needs_review';
      current.analysis_model = obs.model_version;
      current.analysis_version = obs.schema_version;
      current.analysis_completed_at = new Date();
      current.analysis_error = null;
      await this.entries.save(current);

      await this.evaluateCompletedAnalysis(userId, current, obs);
    } catch (err) {
      const current = await this.entries.findOne({
        where: { id: entryId, user_id: userId },
      });
      if (!current || current.photo_object_key !== photoObjectKey) {
        return;
      }
      current.analysis_status = 'failed';
      current.analysis_error = (err as Error).message;
      await this.entries.save(current);
      await this.dispatchNotification({
        userId,
        kind: 'analysis_failed',
        titleKey: NOTIFICATION_KEYS.analysisFailedTitle,
        bodyKey: NOTIFICATION_KEYS.analysisFailedBody,
        severity: 'warning',
        payload: { entry_id: entryId, entry_date: current.entry_date },
        deepLink: `/journal/days/${current.entry_date}`,
      });
    } finally {
      this.releaseAnalysisSlot(userId, analysisKey);
      this.scheduleAnalysisQueueDrain();
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
    if (current.analysis_status === 'completed') {
      return;
    }
    current.analysis_status = 'queued';
    current.analysis_error = reason;
    await this.entries.save(current);
  }

  private enqueueAnalysisRetry(params: QueuedAnalysisRun): void {
    const key = `${params.entryId}:${params.photoObjectKey}`;
    this.queuedAnalysisRuns.set(key, params);
    this.scheduleAnalysisQueueDrain();
  }

  private removeQueuedAnalysisRunsForEntry(entryId: string): void {
    let removed = false;
    for (const [key, run] of this.queuedAnalysisRuns.entries()) {
      if (run.entryId === entryId) {
        this.queuedAnalysisRuns.delete(key);
        removed = true;
      }
    }
    if (removed) {
      this.scheduleAnalysisQueueDrain();
    }
  }

  async recoverInterruptedAnalyses(): Promise<void> {
    const recoverableStatuses: AnalysisStatus[] = [
      'pending',
      'queued',
      'running',
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
      entry.analysis_status = 'queued';
      entry.analysis_error =
        'Analysis queued after service restart; it will retry automatically.';
      await this.entries.save(entry);
      this.enqueueAnalysisRetry({
        userId: entry.user_id,
        entryId: entry.id,
        photoObjectKey: entry.photo_object_key,
        notBefore: Date.now() + ANALYSIS_QUEUE_RETRY_DELAY_MS,
      });
    }
  }

  private scheduleAnalysisQueueDrain(): void {
    if (this.analysisQueueTimer) {
      clearTimeout(this.analysisQueueTimer);
      this.analysisQueueTimer = null;
    }
    const nextRunAt = Math.min(
      ...Array.from(this.queuedAnalysisRuns.values()).map(
        (run) => run.notBefore,
      ),
    );
    if (!Number.isFinite(nextRunAt)) {
      return;
    }
    const delayMs = Math.max(0, nextRunAt - Date.now());
    this.analysisQueueTimer = setTimeout(() => {
      this.analysisQueueTimer = null;
      void this.drainAnalysisQueue().catch((error) => {
        this.logger.error('Failed to drain skin journal analysis queue', error);
      });
    }, delayMs);
    this.analysisQueueTimer.unref?.();
  }

  private async drainAnalysisQueue(): Promise<void> {
    const now = Date.now();
    const dueRuns = Array.from(this.queuedAnalysisRuns.entries()).filter(
      ([, run]) => run.notBefore <= now,
    );
    for (const [key, run] of dueRuns) {
      this.queuedAnalysisRuns.delete(key);
      await this.runAnalysis(run.entryId, run.userId, run.photoObjectKey);
    }
    if (this.queuedAnalysisRuns.size > 0) {
      this.scheduleAnalysisQueueDrain();
    }
  }

  private msUntilNextAnalysisBudgetWindow(): number {
    const nextWindow = new Date();
    nextWindow.setUTCHours(24, 1, 0, 0);
    return Math.max(
      ANALYSIS_QUEUE_RETRY_DELAY_MS,
      nextWindow.getTime() - Date.now() + ANALYSIS_BUDGET_RETRY_GRACE_MS,
    );
  }

  // ---------- EVENTS ----------

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

  // ---------- INSIGHTS ----------

  async listInsights(userId: string): Promise<JournalInsightResponseDto[]> {
    const list = await this.insights.find({
      where: { user_id: userId, dismissed_at: IsNull() },
      order: { generated_at: 'DESC' },
      take: 50,
    });
    await this.recordDataAccess(
      userId,
      UserDataAccessPurpose.SkinJournalInsight,
    );
    return list.map((i) => JournalInsightResponseDto.fromEntity(i));
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

  async generateInsightsIfNeeded(userId: string): Promise<void> {
    const recentEntries = await this.entries.find({
      where: { user_id: userId },
      order: { entry_date: 'DESC' },
      take: 30,
    });
    if (recentEntries.length === 0) return;

    const candidates = buildDeterministicInsights(recentEntries);
    for (const candidate of candidates) {
      const existing = await this.findExistingInsight(userId, {
        kind: candidate.kind,
        related_entry_ids: candidate.related_entry_ids,
      });
      if (existing) {
        continue;
      }
      const insight = await this.insights.save(
        this.insights.create({
          user_id: userId,
          kind: candidate.kind,
          severity: candidate.severity,
          summary: candidate.summary,
          supporting_data: candidate.supporting_data,
          related_entry_ids: candidate.related_entry_ids,
        }),
      );
      await this.recordDataAccess(
        userId,
        UserDataAccessPurpose.SkinJournalInsight,
        UserDataAccessActorType.System,
      );
      await this.dispatchNotification({
        userId,
        kind: 'insight_ready',
        titleKey: NOTIFICATION_KEYS.insightTitle,
        bodyKey: NOTIFICATION_KEYS.insightBody,
        severity: candidate.severity,
        payload: { insight_id: insight.id, kind: candidate.kind },
        deepLink: '/journal?tab=insights',
      });
      if (candidate.kind === 'effectiveness') {
        await this.recordEventOnce(userId, candidate.related_entry_ids.at(-1), {
          kind: 'product_effectiveness',
          severity: candidate.severity,
          payload: candidate.supporting_data,
        });
      }
    }
  }

  private async findExistingInsight(
    userId: string,
    params: { kind: InsightKind; related_entry_ids: string[] },
  ): Promise<SkinJournalInsight | null> {
    const candidates = await this.insights.find({
      where: {
        user_id: userId,
        kind: params.kind,
      },
      order: { generated_at: 'DESC' },
      take: 50,
    });
    return (
      candidates.find((insight) =>
        sameStringSet(
          insight.related_entry_ids ?? [],
          params.related_entry_ids,
        ),
      ) ?? null
    );
  }

  // ---------- WRAPPED ----------

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

  // ---------- SIMPLIFICATION ----------

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

  // ---------- STATS ----------

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

  // ---------- EXPORT ----------

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
      status: 'ready',
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
      await this.deletePhotoBestEffort(objectKey);
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

  // ---------- INTERNAL HELPERS ----------

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
      .filter((insight) => insight.related_entry_ids?.includes(entryId))
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
          (insight.related_entry_ids ?? []).some((id) => entryIds.has(id)),
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
    bullets: Array<{ text: string; tone: 'good' | 'warn' | 'neutral' }>;
  } {
    const bullets: Array<{ text: string; tone: 'good' | 'warn' | 'neutral' }> =
      [];
    if (!from || !to) {
      return { bullets };
    }
    for (const c of CONCERN_KEYS) {
      const a = from.ratings?.[c];
      const b = to.ratings?.[c];
      if (typeof a === 'number' && typeof b === 'number' && a !== b) {
        const tone: 'good' | 'warn' | 'neutral' = b < a ? 'good' : 'warn';
        const verb = b < a ? 'reduced' : 'increased';
        bullets.push({
          text: `${capitalize(c)} ${verb} from ${a} to ${b}`,
          tone,
        });
      }
    }
    if (
      from.analysis_observations?.reaction_signals?.reaction_detected &&
      !to.analysis_observations?.reaction_signals?.reaction_detected
    ) {
      bullets.push({ text: 'Reaction signs cleared', tone: 'good' });
    }
    if (bullets.length === 0) {
      bullets.push({ text: 'No major visible change', tone: 'neutral' });
    }
    return { bullets };
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

  private tryAcquireAnalysisSlot(userId: string, key: string): boolean {
    if (this.analysisInFlight.has(key)) {
      return false;
    }
    const maxGlobal = SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT;
    const maxPerUser = SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT_PER_USER;
    const userCount = this.perUserAnalysisInFlight.get(userId) ?? 0;
    if (this.analysisInFlight.size >= maxGlobal || userCount >= maxPerUser) {
      return false;
    }
    this.analysisInFlight.add(key);
    this.perUserAnalysisInFlight.set(userId, userCount + 1);
    return true;
  }

  private releaseAnalysisSlot(userId: string, key: string): void {
    this.analysisInFlight.delete(key);
    const userCount = this.perUserAnalysisInFlight.get(userId) ?? 0;
    if (userCount <= 1) {
      this.perUserAnalysisInFlight.delete(userId);
      return;
    }
    this.perUserAnalysisInFlight.set(userId, userCount - 1);
  }

  private consumeAnalysisBudget(userId: string): boolean {
    const budgetUsd = SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD;
    if (budgetUsd <= 0) {
      return false;
    }
    const date = new Date().toISOString().slice(0, 10);
    const maxRuns = Math.max(1, Math.floor(budgetUsd / 0.01));
    const counter = this.analysisBudgetCounters.get(userId);
    if (!counter || counter.date !== date) {
      this.analysisBudgetCounters.set(userId, { date, count: 1 });
      return true;
    }
    if (counter.count >= maxRuns) {
      return false;
    }
    counter.count += 1;
    return true;
  }

  private async evaluateCompletedAnalysis(
    userId: string,
    entry: SkinJournalEntry,
    obs: AnalysisObservations,
  ): Promise<void> {
    if (obs.reaction_signals.reaction_detected) {
      const event = await this.recordEvent(userId, entry.id, {
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
      });
      await this.dispatchNotification({
        userId,
        kind: 'reaction_detected',
        titleKey: NOTIFICATION_KEYS.reactionTitle,
        bodyKey: NOTIFICATION_KEYS.reactionBody,
        severity: event.severity === 'critical' ? 'critical' : 'warning',
        payload: { event_id: event.id, entry_id: entry.id },
        deepLink: `/journal/days/${entry.entry_date}`,
      });

      if (
        ['moderate', 'severe'].includes(
          obs.reaction_signals.reaction_severity,
        ) &&
        obs.reaction_signals.confidence >= 0.6
      ) {
        const simplification = await this.startSimplification({
          userId,
          triggeredByEventId: event.id,
          reason:
            'Journal-only barrier-repair safety state triggered by moderate or severe reaction signals.',
        });
        await this.dispatchNotification({
          userId,
          kind: 'simplification_started',
          titleKey: NOTIFICATION_KEYS.simplificationTitle,
          bodyKey: NOTIFICATION_KEYS.simplificationBody,
          severity: event.severity === 'critical' ? 'critical' : 'warning',
          payload: { simplification_id: simplification.id, event_id: event.id },
          deepLink: `/journal/simplification/${simplification.id}`,
        });
      }
    }

    await this.evaluateTrendEvents(userId, entry);
    await this.evaluateReferralThreshold(userId, entry, obs);
    await this.ensureDailyInsightForEntry(userId, entry, obs);
  }

  private async ensureDailyInsightForEntry(
    userId: string,
    entry: SkinJournalEntry,
    obs: AnalysisObservations,
  ): Promise<SkinJournalInsight | null> {
    const existing = await this.findExistingInsight(userId, {
      kind: 'daily',
      related_entry_ids: [entry.id],
    });
    if (existing) {
      return existing;
    }

    const insight = await this.insights.save(
      this.insights.create({
        user_id: userId,
        kind: 'daily',
        severity: obs.reaction_signals.reaction_detected ? 'warning' : 'info',
        summary: entry.analysis_summary ?? this.analysis.shortSummary(obs),
        supporting_data: {
          entry_date: entry.entry_date,
          analysis_status: entry.analysis_status,
          reaction_detected: obs.reaction_signals.reaction_detected,
          reaction_severity: obs.reaction_signals.reaction_severity,
        },
        related_entry_ids: [entry.id],
      }),
    );
    await this.recordDataAccess(
      userId,
      UserDataAccessPurpose.SkinJournalInsight,
      UserDataAccessActorType.System,
    );
    await this.dispatchNotification({
      userId,
      kind: 'insight_ready',
      titleKey: NOTIFICATION_KEYS.insightTitle,
      bodyKey: NOTIFICATION_KEYS.insightBody,
      severity: insight.severity,
      payload: { insight_id: insight.id, kind: insight.kind },
      deepLink: `/journal/days/${entry.entry_date}`,
    });
    return insight;
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

    const existing = await this.insights.findOne({
      where: {
        user_id: userId,
        kind: 'referral',
        dismissed_at: IsNull(),
      },
    });
    if (existing) {
      return;
    }

    const event = await this.recordEvent(userId, entry.id, {
      kind: 'dermatologist_referral',
      severity: 'critical',
      payload: {
        moderate_or_severe_count_7d: moderateOrSevere.length,
        doctor_flag_count_7d: doctorFlags.length,
      },
    });
    const insight = await this.insights.save(
      this.insights.create({
        user_id: userId,
        kind: 'referral',
        severity: 'critical',
        summary:
          'Several recent entries show moderate or severe irritation signals. Consider contacting a dermatologist.',
        supporting_data: {
          moderate_or_severe_count_7d: moderateOrSevere.length,
          doctor_flag_count_7d: doctorFlags.length,
        },
        related_entry_ids: recentEntries.map((entry) => entry.id),
      }),
    );
    await this.recordDataAccess(
      userId,
      UserDataAccessPurpose.SkinJournalInsight,
      UserDataAccessActorType.System,
    );
    await this.dispatchNotification({
      userId,
      kind: 'doctor_referral',
      titleKey: NOTIFICATION_KEYS.referralTitle,
      bodyKey: NOTIFICATION_KEYS.referralBody,
      severity: 'critical',
      payload: { event_id: event.id, insight_id: insight.id },
      deepLink: '/journal?tab=insights',
    });
  }

  private normalizeUpsertBody(body: UpsertEntryDto): UpsertEntryDto {
    return normalizeUpsertEntryBody(body);
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
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const values = new Set(a);
  return b.every((value) => values.has(value));
}
