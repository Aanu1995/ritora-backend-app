import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import { UserConsentType } from '../users/user-consent.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { SkinJournalEvent } from './entities/skin-journal-event.entity';
import { SkinJournalExportJob } from './entities/skin-journal-export-job.entity';
import { SkinJournalInsight } from './entities/skin-journal-insight.entity';
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { SkinJournalAnalysisService } from './services/skin-journal-analysis.service';
import { SkinJournalPhotoStorageService } from './services/skin-journal-photo-storage.service';
import {
  SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD,
  SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT,
  SKIN_JOURNAL_EXPORT_SIGNED_URL_TTL_SECONDS,
} from './skin-journal.constants';
import { SkinJournalService } from './skin-journal.service';
import { todayInTimeZone } from './skin-journal.utils';

const repo = () => ({
  create: jest.fn((data) => data),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  findOneByOrFail: jest.fn(),
  save: jest.fn(async (data) => data),
  delete: jest.fn().mockResolvedValue({ affected: 1 }),
  count: jest.fn().mockResolvedValue(0),
});

function entry(overrides: Partial<SkinJournalEntry> = {}): SkinJournalEntry {
  return {
    id: 'entry-1',
    user_id: 'user-1',
    entry_date: '2026-04-29',
    time_zone: 'UTC',
    photo_object_key: null,
    photo_width: null,
    photo_height: null,
    photo_size: null,
    photo_content_type: null,
    exif_stripped: false,
    angle: 'head_on',
    concern_focus: null,
    is_pre_routine: true,
    ratings: null,
    overall_feel: null,
    sleep_band: null,
    stress_today: null,
    sun_exposure_today: null,
    sweat_exercise_today: null,
    cycle_marker: null,
    recent_change: null,
    complaint_note: null,
    analysis_status: 'skipped',
    analysis_observations: null,
    analysis_summary: null,
    analysis_model: null,
    analysis_version: null,
    analysis_error: null,
    analysis_completed_at: null,
    analysis_retry_count: 0,
    created_at: new Date('2026-04-29T00:00:00.000Z'),
    updated_at: new Date('2026-04-29T00:00:00.000Z'),
    user: undefined as never,
    generateId: jest.fn(),
    ...overrides,
  };
}

describe('SkinJournalService', () => {
  let service: SkinJournalService;
  let entries: ReturnType<typeof repo>;
  let events: ReturnType<typeof repo>;
  let insights: ReturnType<typeof repo>;
  let wrapped: ReturnType<typeof repo>;
  let simplifications: ReturnType<typeof repo>;
  let consents: ReturnType<typeof repo>;
  let exportsRepo: ReturnType<typeof repo>;
  const photoStorage = {
    newEntryId: jest.fn(() => 'entry-1'),
    storePhoto: jest.fn(),
    deletePhoto: jest.fn(),
    getSignedUrl: jest.fn(
      (key: string | null, options?: { ttlSeconds?: number }) =>
        key
          ? `https://signed.example.com/${options?.ttlSeconds ?? 'default'}/${key}`
          : null,
    ),
  };
  const analysis = { analyze: jest.fn(), shortSummary: jest.fn() };
  const dataAccess = {
    recordDataAccess: jest.fn().mockResolvedValue(undefined),
    recordConsentEvent: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { dispatch: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    entries = repo();
    events = repo();
    insights = repo();
    wrapped = repo();
    simplifications = repo();
    consents = repo();
    exportsRepo = repo();
    photoStorage.storePhoto.mockResolvedValue({
      object_key: 'skin-journal/user-1/entry-1/photo.webp',
      width: 100,
      height: 100,
      size: 10,
      content_type: 'image/webp',
      exif_stripped: true,
    });
    photoStorage.deletePhoto.mockResolvedValue(undefined);
    analysis.analyze.mockResolvedValue({
      schema_version: '1.0',
      model_version: 'test-model',
      image_quality: {
        face_detected: true,
        lighting_quality: 'good',
        framing_quality: 'good',
        blur_detected: false,
        issues: [],
      },
      detected_concerns: [],
      reaction_signals: {
        reaction_detected: false,
        reaction_severity: 'none',
        indicators: [],
        confidence: 0.1,
      },
      barrier_signs: { barrier_compromise: false, indicators: [] },
      overall_assessment: 'Looks stable.',
      should_flag_for_doctor: false,
    });
    analysis.shortSummary.mockReturnValue('Looks stable.');

    const module = await Test.createTestingModule({
      providers: [
        SkinJournalService,
        { provide: getRepositoryToken(SkinJournalEntry), useValue: entries },
        { provide: getRepositoryToken(SkinJournalEvent), useValue: events },
        { provide: getRepositoryToken(SkinJournalInsight), useValue: insights },
        { provide: getRepositoryToken(SkinJournalWrapped), useValue: wrapped },
        {
          provide: getRepositoryToken(RoutineSimplificationEvent),
          useValue: simplifications,
        },
        {
          provide: getRepositoryToken(SkinJournalExportJob),
          useValue: exportsRepo,
        },
        { provide: getRepositoryToken(UserConsent), useValue: consents },
        { provide: SkinJournalPhotoStorageService, useValue: photoStorage },
        { provide: SkinJournalAnalysisService, useValue: analysis },
        { provide: UserDataAccessLogService, useValue: dataAccess },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(SkinJournalService);
  });

  it('requires active skin progress consent before photo upload', async () => {
    consents.findOne.mockResolvedValue(null);
    const today = todayInTimeZone('UTC');

    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: today,
        timeZone: 'UTC',
        photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        body: {},
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores replacement photo before deleting the previous object', async () => {
    consents.findOne.mockResolvedValue({
      consent_type: UserConsentType.SkinProgressProcessing,
      granted: true,
      revoked_at: null,
    });
    entries.findOne.mockResolvedValue(
      entry({
        entry_date: todayInTimeZone('UTC'),
        photo_object_key: 'skin-journal/user-1/entry-1/old.webp',
      }),
    );

    await service.upsertEntryForResolvedDate({
      userId: 'user-1',
      targetDate: todayInTimeZone('UTC'),
      timeZone: 'UTC',
      photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
      body: {},
    });

    expect(photoStorage.storePhoto).toHaveBeenCalled();
    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      }),
    );
    expect(photoStorage.deletePhoto).toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/old.webp',
    );
    expect(photoStorage.storePhoto.mock.invocationCallOrder[0]).toBeLessThan(
      entries.save.mock.invocationCallOrder[0],
    );
    expect(entries.save.mock.invocationCallOrder[0]).toBeLessThan(
      photoStorage.deletePhoto.mock.invocationCallOrder[0],
    );
  });

  it('clears stale analysis artifacts when replacing an existing photo', async () => {
    consents.findOne.mockResolvedValue({
      consent_type: UserConsentType.SkinProgressProcessing,
      granted: true,
      revoked_at: null,
    });
    entries.findOne.mockResolvedValue(
      entry({
        id: 'entry-1',
        entry_date: todayInTimeZone('UTC'),
        photo_object_key: 'skin-journal/user-1/entry-1/old.webp',
      }),
    );
    insights.find.mockResolvedValue([
      {
        id: 'insight-stale',
        user_id: 'user-1',
        kind: 'daily',
        related_entry_ids: ['entry-1'],
      },
      {
        id: 'insight-other',
        user_id: 'user-1',
        kind: 'weekly',
        related_entry_ids: ['entry-other'],
      },
    ]);

    await service.upsertEntryForResolvedDate({
      userId: 'user-1',
      targetDate: todayInTimeZone('UTC'),
      timeZone: 'UTC',
      photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
      body: {},
    });

    expect(events.delete).toHaveBeenCalledWith({
      user_id: 'user-1',
      entry_id: 'entry-1',
    });
    expect(insights.delete).toHaveBeenCalledWith({
      user_id: 'user-1',
      id: expect.any(Object),
    });
    expect(insights.delete.mock.calls[0]?.[0].id._value).toEqual([
      'insight-stale',
    ]);
  });

  it('does not fail replacement when deleting the old photo fails after save', async () => {
    consents.findOne.mockResolvedValue({
      consent_type: UserConsentType.SkinProgressProcessing,
      granted: true,
      revoked_at: null,
    });
    entries.findOne.mockResolvedValue(
      entry({
        entry_date: todayInTimeZone('UTC'),
        photo_object_key: 'skin-journal/user-1/entry-1/old.webp',
      }),
    );
    photoStorage.deletePhoto.mockRejectedValueOnce(new Error('s3 unavailable'));

    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: todayInTimeZone('UTC'),
        timeZone: 'UTC',
        photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        body: {},
      }),
    ).resolves.toMatchObject({ id: 'entry-1' });

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      }),
    );
  });

  it('deletes a newly stored replacement photo when the database save fails', async () => {
    consents.findOne.mockResolvedValue({
      consent_type: UserConsentType.SkinProgressProcessing,
      granted: true,
      revoked_at: null,
    });
    entries.findOne.mockResolvedValue(
      entry({
        entry_date: todayInTimeZone('UTC'),
        photo_object_key: 'skin-journal/user-1/entry-1/old.webp',
      }),
    );
    entries.save.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: todayInTimeZone('UTC'),
        timeZone: 'UTC',
        photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        body: {},
      }),
    ).rejects.toThrow('database unavailable');

    expect(photoStorage.deletePhoto).toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/photo.webp',
    );
    expect(photoStorage.deletePhoto).not.toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/old.webp',
    );
  });

  it('keeps the photo when entry deletion fails before media cleanup', async () => {
    entries.findOne.mockResolvedValue(
      entry({ photo_object_key: 'skin-journal/user-1/entry-1/photo.webp' }),
    );
    entries.delete.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.deleteEntry('user-1', 'entry-1')).rejects.toThrow(
      'database unavailable',
    );

    expect(photoStorage.deletePhoto).not.toHaveBeenCalled();
  });

  it('continues account media cleanup when one object delete fails', async () => {
    entries.find.mockResolvedValue([
      entry({
        id: 'entry-1',
        photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      }),
      entry({
        id: 'entry-2',
        photo_object_key: 'skin-journal/user-1/entry-2/photo.webp',
      }),
    ]);
    wrapped.find.mockResolvedValue([
      {
        media_object_key: 'skin-journal/user-1/wrapped-1/photo.webp',
      },
    ]);
    photoStorage.deletePhoto
      .mockRejectedValueOnce(new Error('s3 unavailable'))
      .mockResolvedValue(undefined);

    await expect(
      service.deleteAllMediaForUser('user-1'),
    ).resolves.toBeUndefined();

    expect(photoStorage.deletePhoto).toHaveBeenCalledTimes(3);
    expect(photoStorage.deletePhoto).toHaveBeenNthCalledWith(
      2,
      'skin-journal/user-1/entry-2/photo.webp',
    );
    expect(photoStorage.deletePhoto).toHaveBeenNthCalledWith(
      3,
      'skin-journal/user-1/wrapped-1/photo.webp',
    );
  });

  it('stores export jobs without expiring photo URLs and signs photos on response', async () => {
    entries.find.mockResolvedValue([
      entry({ photo_object_key: 'skin-journal/user-1/entry-1/photo.webp' }),
    ]);
    exportsRepo.save.mockImplementation(async (data) => ({
      id: 'export-1',
      created_at: new Date('2026-04-29T00:00:00.000Z'),
      ...data,
    }));

    const result = await service.createExport('user-1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(result.status).toBe('ready');
    expect(result.payload?.entries[0].photo_url).toContain(
      `https://signed.example.com/${SKIN_JOURNAL_EXPORT_SIGNED_URL_TTL_SECONDS}/`,
    );
    const savedJob = exportsRepo.save.mock.calls[0]?.[0] as
      | Partial<SkinJournalExportJob>
      | undefined;
    expect(savedJob?.payload?.entries[0].photo_object_key).toBe(
      'skin-journal/user-1/entry-1/photo.webp',
    );
    expect(savedJob?.payload?.entries[0].photo_url).toBeNull();

    exportsRepo.findOne.mockResolvedValue({
      id: 'export-1',
      user_id: 'user-1',
      range_from: '2026-04-01',
      range_to: '2026-04-30',
      status: 'ready',
      payload: savedJob?.payload ?? null,
      error: null,
      created_at: new Date('2026-04-29T00:00:00.000Z'),
    });

    const fetched = await service.getExport('user-1', 'export-1');
    expect(fetched.payload?.entries[0].photo_url).toContain(
      `https://signed.example.com/${SKIN_JOURNAL_EXPORT_SIGNED_URL_TTL_SECONDS}/`,
    );
    expect(photoStorage.getSignedUrl).toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/photo.webp',
      { ttlSeconds: SKIN_JOURNAL_EXPORT_SIGNED_URL_TTL_SECONDS },
    );
    expect(dataAccess.recordDataAccess).toHaveBeenCalled();
  });

  it('filters events by the related journal entry date range', async () => {
    entries.find.mockResolvedValue([
      entry({ id: 'entry-in-range', entry_date: '2026-04-10' }),
    ]);
    events.find.mockResolvedValue([
      {
        id: 'event-1',
        user_id: 'user-1',
        entry_id: 'entry-in-range',
        kind: 'worsening',
        severity: 'warning',
        payload: null,
        acknowledged_at: null,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      },
      {
        id: 'event-2',
        user_id: 'user-1',
        entry_id: 'entry-out-of-range',
        kind: 'recovery',
        severity: 'info',
        payload: null,
        acknowledged_at: null,
        created_at: new Date('2026-04-10T00:00:00.000Z'),
      },
    ]);

    const result = await service.listEvents('user-1', {
      from: '2026-04-01',
      to: '2026-04-30',
    });

    expect(result.map((event) => event.id)).toEqual(['event-1']);
  });

  it('creates deterministic worsening and recovery events after analysis', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-10',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      ratings: { redness: 4 },
      analysis_status: 'pending',
    });
    const previous = entry({
      id: 'entry-previous',
      entry_date: '2026-04-09',
      ratings: { redness: 1 },
      analysis_observations: {
        schema_version: '1.0',
        model_version: 'test-model',
        image_quality: {
          face_detected: true,
          lighting_quality: 'good',
          framing_quality: 'good',
          blur_detected: false,
          issues: [],
        },
        detected_concerns: [],
        reaction_signals: {
          reaction_detected: true,
          reaction_severity: 'moderate',
          indicators: ['redness_spike'],
          confidence: 0.8,
        },
        barrier_signs: { barrier_compromise: true, indicators: [] },
        overall_assessment: 'Possible irritation signals.',
        should_flag_for_doctor: false,
      },
    });
    entries.findOne.mockResolvedValue(current);
    entries.find.mockResolvedValue([previous, current]);
    events.findOne.mockResolvedValue(null);

    await service.runAnalysis('entry-current', 'user-1');

    const savedKinds = events.save.mock.calls.map(
      ([event]) => event.kind as string,
    );
    expect(savedKinds).toEqual(
      expect.arrayContaining(['worsening', 'recovery']),
    );
  });

  it('creates product-effectiveness events from deterministic insight signals', async () => {
    const entriesForTrend = Array.from({ length: 8 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        entry_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
        ratings: { redness: index < 4 ? 4 : 1 },
        recent_change:
          index === 4
            ? {
                kind: 'started_new_product',
                related_inventory_product_id: 'inventory-1',
                note: null,
              }
            : null,
      }),
    ).reverse();
    entries.find.mockResolvedValue(entriesForTrend);
    insights.findOne.mockResolvedValue(null);
    events.findOne.mockResolvedValue(null);

    await service.generateInsightsIfNeeded('user-1');

    expect(events.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'product_effectiveness' }),
    );
  });

  it('creates the selected day daily insight immediately after analysis completes', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-10',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'pending',
    });
    entries.findOne.mockResolvedValue(current);
    entries.find.mockResolvedValue([current]);
    insights.findOne.mockResolvedValue(null);
    insights.save.mockImplementation(async (data) => ({
      id: 'insight-1',
      generated_at: new Date('2026-04-10T09:00:00.000Z'),
      seen_at: null,
      dismissed_at: null,
      ...data,
    }));
    wrapped.findOne.mockResolvedValue(null);

    await service.runAnalysis('entry-current', 'user-1');

    expect(insights.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'daily',
        related_entry_ids: ['entry-current'],
      }),
    );
    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'insight_ready',
        payload: expect.objectContaining({ insight_id: 'insight-1' }),
      }),
    );
  });

  it('marks analysis queued instead of leaving pending when concurrency is capped', async () => {
    const current = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'pending',
    });
    entries.findOne.mockResolvedValue(current);
    const internals = service as unknown as {
      analysisInFlight: Set<string>;
      analysisQueueTimer: ReturnType<typeof setTimeout> | null;
      queuedAnalysisRuns: Map<string, unknown>;
    };
    for (let i = 0; i < SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT; i += 1) {
      internals.analysisInFlight.add(`busy-${i}`);
    }
    const analyzeCallsBefore = analysis.analyze.mock.calls.length;

    await service.runAnalysis(
      current.id,
      'user-1',
      'skin-journal/user-1/entry-current/photo.webp',
    );

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_status: 'queued',
        analysis_error: expect.stringContaining('queued'),
      }),
    );
    expect(internals.queuedAnalysisRuns.size).toBe(1);
    expect(internals.analysisQueueTimer).not.toBeNull();
    expect(analysis.analyze).toHaveBeenCalledTimes(analyzeCallsBefore);
  });

  it('marks analysis queued instead of leaving pending when daily budget is exhausted', async () => {
    const current = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'pending',
    });
    entries.findOne.mockResolvedValue(current);
    const internals = service as unknown as {
      analysisBudgetCounters: Map<string, { date: string; count: number }>;
      analysisQueueTimer: ReturnType<typeof setTimeout> | null;
      queuedAnalysisRuns: Map<string, unknown>;
    };
    const dailyRunLimit = Math.max(
      1,
      Math.floor(SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD / 0.01),
    );
    internals.analysisBudgetCounters.set('user-1', {
      date: new Date().toISOString().slice(0, 10),
      count: dailyRunLimit,
    });
    const analyzeCallsBefore = analysis.analyze.mock.calls.length;

    await service.runAnalysis(
      current.id,
      'user-1',
      'skin-journal/user-1/entry-current/photo.webp',
    );

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_status: 'queued',
        analysis_error: expect.stringContaining('budget'),
      }),
    );
    expect(internals.queuedAnalysisRuns.size).toBe(1);
    expect(internals.analysisQueueTimer).not.toBeNull();
    expect(analysis.analyze).toHaveBeenCalledTimes(analyzeCallsBefore);
  });

  it('clears queued analysis timers and in-memory state on module destroy', () => {
    const internals = service as unknown as {
      analysisInFlight: Set<string>;
      perUserAnalysisInFlight: Map<string, number>;
      analysisQueueTimer: ReturnType<typeof setTimeout> | null;
      queuedAnalysisRuns: Map<string, unknown>;
    };
    internals.analysisInFlight.add('entry-1:photo-1');
    internals.perUserAnalysisInFlight.set('user-1', 1);
    internals.queuedAnalysisRuns.set('entry-1:photo-1', {
      userId: 'user-1',
      entryId: 'entry-1',
      photoObjectKey: 'photo-1',
      notBefore: Date.now() + 60000,
    });
    internals.analysisQueueTimer = setTimeout(() => undefined, 60000);

    service.onModuleDestroy();

    expect(internals.analysisQueueTimer).toBeNull();
    expect(internals.analysisInFlight.size).toBe(0);
    expect(internals.perUserAnalysisInFlight.size).toBe(0);
    expect(internals.queuedAnalysisRuns.size).toBe(0);
  });

  it('clears stale queued analysis runs when deleting an entry', async () => {
    const current = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'queued',
    });
    entries.findOne.mockResolvedValue(current);
    const internals = service as unknown as {
      queuedAnalysisRuns: Map<string, unknown>;
    };
    internals.queuedAnalysisRuns.set(
      'entry-current:skin-journal/user-1/entry-current/photo.webp',
      {
        userId: 'user-1',
        entryId: 'entry-current',
        photoObjectKey: 'skin-journal/user-1/entry-current/photo.webp',
        notBefore: Date.now() + 60000,
      },
    );

    await service.deleteEntry('user-1', 'entry-current');

    expect(internals.queuedAnalysisRuns.size).toBe(0);
  });

  it('requeues interrupted pending/running analysis work after process restart', async () => {
    const interrupted = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'running',
    });
    entries.find.mockResolvedValue([interrupted]);
    const internals = service as unknown as {
      queuedAnalysisRuns: Map<string, unknown>;
    };

    await (
      service as SkinJournalService & {
        recoverInterruptedAnalyses: () => Promise<void>;
      }
    ).recoverInterruptedAnalyses();

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'entry-current',
        analysis_status: 'queued',
        analysis_error: expect.stringContaining('restart'),
      }),
    );
    expect(internals.queuedAnalysisRuns.size).toBe(1);
  });

  it('does not auto-generate a monthly wrapped when analysis completes', async () => {
    const photos = [1, 2, 3].map((day) =>
      entry({
        id: `entry-${day}`,
        entry_date: `2026-04-0${day}`,
        photo_object_key: `skin-journal/user-1/entry-${day}/photo.webp`,
        analysis_status: 'completed',
        analysis_summary: `Summary ${day}`,
      }),
    );
    const current = photos[2];
    entries.findOne.mockResolvedValue(current);
    entries.find.mockResolvedValue(photos);
    insights.findOne.mockResolvedValue({ id: 'existing-daily' });
    wrapped.findOne.mockResolvedValue(null);
    wrapped.save.mockImplementation(async (data) => ({
      id: 'wrapped-1',
      created_at: new Date('2026-04-10T09:00:00.000Z'),
      ...data,
    }));

    await service.runAnalysis(current.id, 'user-1');

    expect(wrapped.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ period_kind: 'monthly' }),
    );
    expect(notifications.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'wrapped_ready' }),
    );
  });

  it('does not include wrapped status in the calendar payload', async () => {
    const photos = [1, 2, 3].map((day) =>
      entry({
        id: `entry-${day}`,
        entry_date: `2026-04-0${day}`,
        photo_object_key: `skin-journal/user-1/entry-${day}/photo.webp`,
        analysis_status: 'completed',
      }),
    );
    entries.find.mockResolvedValue(photos);
    wrapped.findOne.mockResolvedValue(null);

    const result = await service.getCalendar('user-1', '2026-04');

    expect(wrapped.save).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('wrapped');
  });

  it('returns an empty wrapped list while wrapped generation is disabled', async () => {
    wrapped.find.mockResolvedValue([
      {
        id: 'wrapped-1',
        user_id: 'user-1',
        period_kind: 'monthly',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        status: 'ready',
        manifest: {
          entries: [
            {
              entry_id: 'entry-1',
              entry_date: '2026-04-01',
              photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
            },
          ],
          timing: { fade_ms: 400, hold_ms: 1400 },
        },
        media_object_key: null,
        error: null,
        generated_at: new Date('2026-04-30T09:00:00.000Z'),
        created_at: new Date('2026-04-30T09:00:00.000Z'),
      },
    ]);

    const result = await service.listWrapped('user-1');

    expect(result).toEqual([]);
  });

  it('does not recreate deterministic insights after the user dismisses the same insight', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-10',
      analysis_status: 'completed',
      analysis_summary: 'Looks stable.',
    });
    entries.find.mockResolvedValue([current]);
    insights.find.mockImplementation(
      async (options: { where?: Record<string, unknown> }) => {
        expect(options.where).toEqual(
          expect.not.objectContaining({
            dismissed_at: expect.anything(),
          }),
        );
        return [
          {
            id: 'insight-dismissed',
            user_id: 'user-1',
            generated_at: new Date('2026-04-10T09:00:00.000Z'),
            kind: 'daily',
            summary: 'Dismissed summary',
            supporting_data: null,
            related_entry_ids: ['entry-current'],
            severity: 'info',
            seen_at: null,
            dismissed_at: new Date('2026-04-10T10:00:00.000Z'),
          },
        ];
      },
    );
    const insightNotificationsBefore = notifications.dispatch.mock.calls.filter(
      ([payload]) => payload.kind === 'insight_ready',
    ).length;

    await service.generateInsightsIfNeeded('user-1');

    expect(insights.save).not.toHaveBeenCalled();
    const insightNotificationsAfter = notifications.dispatch.mock.calls.filter(
      ([payload]) => payload.kind === 'insight_ready',
    ).length;
    expect(insightNotificationsAfter).toBe(insightNotificationsBefore);
  });

  it('rejects invalid date filters before listing photos or comparing dates', async () => {
    await expect(
      service.listPhotos('user-1', { from: '2026-02-31' }),
    ).rejects.toThrow('Invalid from date');

    await expect(
      service.getCompare('user-1', '2026-04-01', '2026-02-31'),
    ).rejects.toThrow('Invalid date');
  });
});
