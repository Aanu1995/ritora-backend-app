import {
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import { UserConsentType } from '../users/user-consent.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { SkinJournalEvent } from './entities/skin-journal-event.entity';
import { SkinJournalExportJob } from './entities/skin-journal-export-job.entity';
import { SkinJournalInsight } from './entities/skin-journal-insight.entity';
import { SkinJournalInsightGenerationRun } from './entities/skin-journal-insight-generation-run.entity';
import { SkinJournalInsightJob } from './entities/skin-journal-insight-job.entity';
import { SkinJournalInsightState } from './entities/skin-journal-insight-state.entity';
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { SkinJournalAnalysisService } from './services/skin-journal-analysis.service';
import { SkinJournalPhotoInterpretationService } from './services/skin-journal-photo-interpretation.service';
import { SkinJournalAnalysisQueueService } from './services/skin-journal-analysis-queue.service';
import { SkinJournalInsightQueueService } from './services/skin-journal-insight-queue.service';
import { SkinJournalMediaRetentionService } from './services/skin-journal-media-retention.service';
import { InsightPolishService } from './insights/insight-polish.service';
import { KnowledgeBaseService } from './insights/knowledge-base/knowledge-base.service';
import { SkinJournalPhotoStorageService } from './services/skin-journal-photo-storage.service';
import {
  AnalysisObservations,
  SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
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
  createQueryBuilder: jest.fn(),
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
    analysis_interpretation: null,
    analysis_concern_keys: [],
    has_reaction_signal: false,
    needs_retake: false,
    analysis_summary: null,
    analysis_model: null,
    analysis_version: null,
    analysis_prompt_version: null,
    analysis_error: null,
    analysis_started_at: null,
    analysis_completed_at: null,
    analysis_duration_ms: null,
    analysis_input_image_count: null,
    analysis_input_tokens: null,
    analysis_output_tokens: null,
    analysis_total_tokens: null,
    analysis_estimated_cost_usd: null,
    analysis_retry_count: 0,
    created_at: new Date('2026-04-29T00:00:00.000Z'),
    updated_at: new Date('2026-04-29T00:00:00.000Z'),
    user: undefined as never,
    generateId: jest.fn(),
    ...overrides,
  };
}

function analysisRunResult(
  observations: AnalysisObservations,
  overrides: {
    prompt_version?: string;
    duration_ms?: number;
    input_image_count?: number;
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
    estimated_cost_usd?: number | null;
  } = {},
) {
  return {
    observations,
    metadata: {
      prompt_version:
        overrides.prompt_version ?? SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
      duration_ms: overrides.duration_ms ?? 25,
      input_image_count: overrides.input_image_count ?? 1,
      input_tokens: overrides.input_tokens ?? null,
      output_tokens: overrides.output_tokens ?? null,
      total_tokens: overrides.total_tokens ?? null,
      estimated_cost_usd: overrides.estimated_cost_usd ?? null,
    },
  };
}

function insightInputSignature(entries: SkinJournalEntry[]): string {
  const payload = [...entries]
    .sort((left, right) => left.entry_date.localeCompare(right.entry_date))
    .map((item) => ({
      id: item.id,
      entry_date: item.entry_date,
      updated_at: item.updated_at?.toISOString?.() ?? null,
      photo_object_key: item.photo_object_key,
      analysis_status: item.analysis_status,
      analysis_concern_keys: item.analysis_concern_keys,
      has_reaction_signal: item.has_reaction_signal,
      needs_retake: item.needs_retake,
      analysis_summary: item.analysis_summary,
      analysis_observations: item.analysis_observations,
      analysis_interpretation: item.analysis_interpretation,
      ratings: item.ratings,
      overall_feel: item.overall_feel,
      sleep_band: item.sleep_band,
      stress_today: item.stress_today,
      sun_exposure_today: item.sun_exposure_today,
      sweat_exercise_today: item.sweat_exercise_today,
      cycle_marker: item.cycle_marker,
      recent_change: item.recent_change,
      complaint_note: item.complaint_note,
    }));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const COMPLETE_CHECK_IN_BODY = {
  overall_feel: 'good',
  ratings: {
    oiliness: 2,
    dryness: 2,
    redness: 2,
    breakouts: 2,
    texture: 2,
    irritation: 2,
    sensitivity: 2,
  },
  sleep_band: '7to9h',
  stress_today: 'low',
  sun_exposure_today: 'brief',
  sweat_exercise_today: false,
  cycle_marker: 'dont_track',
} as const;

function completeSkinProfile(
  overrides: Partial<SkinProfile> = {},
): SkinProfile {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    skin_type: 'oily',
    skin_tone: 'medium',
    ethnicity: 'black',
    current_concerns: ['acne'],
    country_code: 'SE',
    city: 'Stockholm',
    fitzpatrick_phototype: 'IV',
    sensitivity_level: null,
    hydration_level: null,
    primary_goal: 'clear_acne',
    pregnancy_status: null,
    under_dermatologist_care: null,
    allow_smart_picks: true,
    budget_tier: 'mid',
    safety_context: {},
    reaction_history: {},
    concern_details: {
      per_concern: [{ concern: 'acne', severity: 'moderate', priority: 1 }],
    },
    skin_behavior: {
      pih_tendency: 'often',
      melasma_tendency: 'never',
      keloid_tendency: 'never',
      sunscreen_habit: 'most_days',
      sunscreen_tolerance: 'fine',
    },
    active_tolerances: {},
    routine_preferences: {
      pace: 'cautious',
      fragrance_free: true,
      non_comedogenic: true,
      sunscreen_filter: 'hybrid',
      sunscreen_finish: 'natural',
    },
    lifestyle_context: {},
    shopping_preferences: {},
    hormonal_context: {},
    created_at: new Date('2026-04-29T00:00:00.000Z'),
    updated_at: new Date('2026-04-29T00:00:00.000Z'),
    user: {
      id: 'user-1',
      date_of_birth: '1992-04-15',
      sex_at_birth: 'female',
    },
    generateId: jest.fn(),
    ...overrides,
  } as SkinProfile;
}

describe('SkinJournalService', () => {
  let service: SkinJournalService;
  let entries: ReturnType<typeof repo>;
  let events: ReturnType<typeof repo>;
  let insights: ReturnType<typeof repo>;
  let insightRuns: ReturnType<typeof repo>;
  let insightStates: ReturnType<typeof repo>;
  let wrapped: ReturnType<typeof repo>;
  let simplifications: ReturnType<typeof repo>;
  let consents: ReturnType<typeof repo>;
  let exportsRepo: ReturnType<typeof repo>;
  let skinProfiles: ReturnType<typeof repo>;
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
  const analysis = {
    analyze: jest.fn(),
    promptVersion: jest.fn(() => SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION),
  };
  const photoInterpretation = {
    interpret: jest.fn(() => ({
      version: '1.0',
      code: 'stable_baseline',
      severity: 'info',
      summary_key: 'journal.analysis.interpretation.stableBaseline.summary',
      summary_values: {},
      guidance_keys: [
        'journal.analysis.interpretation.stableBaseline.guidance',
      ],
      caveat_keys: ['journal.analysis.interpretation.caveats.notDiagnosis'],
      source_ids: [],
      sources: [],
      generated_at: '2026-05-01T08:00:00.000Z',
    })),
  };
  const analysisQueue = {
    isReady: jest.fn().mockResolvedValue(true),
    enqueueAnalysisJob: jest.fn().mockResolvedValue({
      id: 'analysis-job-1',
      attempt_count: 0,
      max_attempts: 5,
    }),
    cancelActiveJobsForEntry: jest.fn().mockResolvedValue(undefined),
    cancelJob: jest.fn().mockResolvedValue(undefined),
    completeJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
    rescheduleJob: jest.fn().mockResolvedValue(undefined),
    recoverExpiredLocks: jest.fn().mockResolvedValue(0),
    getMaxAttempts: jest.fn(() => 5),
    nextRetryAt: jest.fn(() => new Date('2026-04-30T00:01:00.000Z')),
    getQueueMetrics: jest.fn().mockResolvedValue({
      driver: 'database',
      queued_count: 0,
      sent_count: 0,
      running_count: 0,
      failed_count: 0,
      completed_count: 0,
      cancelled_count: 0,
      oldest_queued_age_seconds: null,
      retrying_count: 0,
      sqs_visible_count: null,
      sqs_not_visible_count: null,
      sqs_oldest_message_age_seconds: null,
      sqs_redrive_policy_configured: null,
      dlq_visible_count: null,
      dlq_oldest_message_age_seconds: null,
    }),
  };
  const insightQueue = {
    enqueueInsightJob: jest.fn().mockResolvedValue({
      id: 'insight-job-1',
      attempt_count: 0,
      max_attempts: 5,
    }),
    getActiveJobForUser: jest.fn().mockResolvedValue(null),
    completeJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
    rescheduleJob: jest.fn().mockResolvedValue(undefined),
    getMaxAttempts: jest.fn(() => 5),
    nextRetryAt: jest.fn(() => new Date('2026-04-30T00:05:00.000Z')),
  };
  const mediaRetention = {
    enqueueDeletionVerification: jest.fn().mockResolvedValue(undefined),
  };
  const dataAccess = {
    recordDataAccess: jest.fn().mockResolvedValue(undefined),
    recordConsentEvent: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = {
    dispatch: jest.fn().mockResolvedValue(undefined),
    getPreferences: jest.fn().mockResolvedValue({
      ai_polished_insights_enabled: true,
    }),
  };
  const insightPolish = {
    polish: jest.fn(async (candidates) => candidates),
  };
  const knowledgeBase = {
    resolveMany: jest.fn(() => []),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'SKIN_JOURNAL_OPERATIONS_TOKEN') {
        return 'ops-token-123456789012345678901234';
      }
      return fallback;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    entries = repo();
    events = repo();
    insights = repo();
    insightRuns = repo();
    insightStates = repo();
    wrapped = repo();
    simplifications = repo();
    consents = repo();
    exportsRepo = repo();
    skinProfiles = repo();
    skinProfiles.findOne.mockResolvedValue(completeSkinProfile());
    photoStorage.storePhoto.mockResolvedValue({
      object_key: 'skin-journal/user-1/entry-1/photo.webp',
      width: 100,
      height: 100,
      size: 10,
      content_type: 'image/webp',
      exif_stripped: true,
    });
    photoStorage.deletePhoto.mockResolvedValue(undefined);
    analysis.analyze.mockResolvedValue(
      analysisRunResult({
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
      }),
    );
    photoInterpretation.interpret.mockClear();
    analysisQueue.enqueueAnalysisJob.mockClear();
    analysisQueue.cancelActiveJobsForEntry.mockClear();
    analysisQueue.cancelJob.mockClear();
    analysisQueue.completeJob.mockClear();
    analysisQueue.failJob.mockClear();
    analysisQueue.rescheduleJob.mockClear();
    analysisQueue.recoverExpiredLocks.mockClear();
    analysisQueue.isReady.mockClear();
    analysisQueue.getMaxAttempts.mockClear();
    analysisQueue.nextRetryAt.mockClear();
    analysisQueue.getQueueMetrics.mockClear();
    insightQueue.enqueueInsightJob.mockClear();
    insightQueue.getActiveJobForUser.mockClear();
    insightQueue.completeJob.mockClear();
    insightQueue.failJob.mockClear();
    insightQueue.rescheduleJob.mockClear();
    insightQueue.getMaxAttempts.mockClear();
    insightQueue.nextRetryAt.mockClear();
    mediaRetention.enqueueDeletionVerification.mockClear();
    config.get.mockClear();

    const module = await Test.createTestingModule({
      providers: [
        SkinJournalService,
        { provide: getRepositoryToken(SkinJournalEntry), useValue: entries },
        { provide: getRepositoryToken(SkinJournalEvent), useValue: events },
        { provide: getRepositoryToken(SkinJournalInsight), useValue: insights },
        {
          provide: getRepositoryToken(SkinJournalInsightGenerationRun),
          useValue: insightRuns,
        },
        {
          provide: getRepositoryToken(SkinJournalInsightState),
          useValue: insightStates,
        },
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
        { provide: getRepositoryToken(SkinProfile), useValue: skinProfiles },
        { provide: SkinJournalPhotoStorageService, useValue: photoStorage },
        { provide: SkinJournalAnalysisService, useValue: analysis },
        {
          provide: SkinJournalPhotoInterpretationService,
          useValue: photoInterpretation,
        },
        { provide: SkinJournalAnalysisQueueService, useValue: analysisQueue },
        { provide: SkinJournalInsightQueueService, useValue: insightQueue },
        { provide: SkinJournalMediaRetentionService, useValue: mediaRetention },
        { provide: InsightPolishService, useValue: insightPolish },
        { provide: KnowledgeBaseService, useValue: knowledgeBase },
        { provide: ConfigService, useValue: config },
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
        body: { skip_check_in: true },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects today journal uploads when the skin profile is missing', async () => {
    skinProfiles.findOne.mockResolvedValue(null);
    consents.findOne.mockResolvedValue({
      consent_type: UserConsentType.SkinProgressProcessing,
      granted: true,
      revoked_at: null,
    });

    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: todayInTimeZone('UTC'),
        timeZone: 'UTC',
        photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        body: {
          skip_check_in: true,
          photo_processing_consent: true,
        },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'skin_profile_required',
      }),
    });

    expect(photoStorage.storePhoto).not.toHaveBeenCalled();
    expect(entries.save).not.toHaveBeenCalled();
  });

  it('rejects today journal check-ins when essential skin profile fields are incomplete', async () => {
    skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile({ primary_goal: null }),
    );

    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: todayInTimeZone('UTC'),
        timeZone: 'UTC',
        photo: null,
        body: COMPLETE_CHECK_IN_BODY,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'skin_profile_required',
      }),
    });

    expect(entries.save).not.toHaveBeenCalled();
  });

  it('rejects creating or replacing a past journal entry', async () => {
    consents.findOne.mockResolvedValue({
      consent_type: UserConsentType.SkinProgressProcessing,
      granted: true,
      revoked_at: null,
    });

    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: '2026-04-29',
        timeZone: 'UTC',
        photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        body: { skip_check_in: true },
      }),
    ).rejects.toThrow('Journal entries can only be changed on their local day');

    expect(photoStorage.storePhoto).not.toHaveBeenCalled();
    expect(entries.save).not.toHaveBeenCalled();
  });

  it('rejects editing check-in fields once the local journal day has elapsed', async () => {
    entries.findOne.mockResolvedValue(
      entry({
        entry_date: '2026-04-29',
        time_zone: 'UTC',
      }),
    );

    await expect(
      service.updateEntryById('user-1', 'entry-1', {
        complaint_note: 'changed later',
      }),
    ).rejects.toThrow('Journal entries can only be changed on their local day');

    expect(entries.save).not.toHaveBeenCalled();
  });

  it('allows analysis retry after the local journal day has elapsed', async () => {
    entries.findOne.mockResolvedValue(
      entry({
        entry_date: '2026-04-29',
        time_zone: 'UTC',
        photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
        analysis_status: 'failed',
      }),
    );
    entries.findOneByOrFail.mockResolvedValue(
      entry({
        entry_date: '2026-04-29',
        time_zone: 'UTC',
        photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
        analysis_status: 'queued',
        analysis_retry_count: 1,
      }),
    );

    await expect(
      service.retryAnalysis('user-1', 'entry-1'),
    ).resolves.toMatchObject({
      id: 'entry-1',
      analysis_status: 'queued',
      analysis_retry_count: 1,
    });

    expect(analysisQueue.enqueueAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
      }),
    );
    expect(analysis.analyze).not.toHaveBeenCalled();
  });

  it('rejects incomplete check-in saves unless the request is photo-only', async () => {
    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: todayInTimeZone('UTC'),
        timeZone: 'UTC',
        photo: null,
        body: {
          overall_feel: 'good',
          ratings: { oiliness: 2, dryness: 2 },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(entries.save).not.toHaveBeenCalled();
  });

  it('allows photo-only saves without check-in fields when skip_check_in is true', async () => {
    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: todayInTimeZone('UTC'),
        timeZone: 'UTC',
        photo: null,
        body: { skip_check_in: true },
      }),
    ).resolves.toMatchObject({ analysis_status: 'skipped' });

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_status: 'skipped',
      }),
    );
    const savedEntry = entries.save.mock.calls[0]?.[0] as SkinJournalEntry;
    expect(savedEntry.ratings).toBeUndefined();
    expect(savedEntry.overall_feel).toBeUndefined();
  });

  it('saves complete check-in data when every required check-in field is present', async () => {
    await service.upsertEntryForResolvedDate({
      userId: 'user-1',
      targetDate: todayInTimeZone('UTC'),
      timeZone: 'UTC',
      photo: null,
      body: COMPLETE_CHECK_IN_BODY,
    });

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ratings: COMPLETE_CHECK_IN_BODY.ratings,
        overall_feel: COMPLETE_CHECK_IN_BODY.overall_feel,
        sleep_band: COMPLETE_CHECK_IN_BODY.sleep_band,
        stress_today: COMPLETE_CHECK_IN_BODY.stress_today,
        sun_exposure_today: COMPLETE_CHECK_IN_BODY.sun_exposure_today,
        sweat_exercise_today: COMPLETE_CHECK_IN_BODY.sweat_exercise_today,
        cycle_marker: COMPLETE_CHECK_IN_BODY.cycle_marker,
      }),
    );
  });

  it('allows partial check-in edits only when the stored entry is already complete', async () => {
    entries.findOne.mockResolvedValue(
      entry({
        entry_date: todayInTimeZone('UTC'),
        ratings: COMPLETE_CHECK_IN_BODY.ratings,
        overall_feel: COMPLETE_CHECK_IN_BODY.overall_feel,
        sleep_band: COMPLETE_CHECK_IN_BODY.sleep_band,
        stress_today: COMPLETE_CHECK_IN_BODY.stress_today,
        sun_exposure_today: COMPLETE_CHECK_IN_BODY.sun_exposure_today,
        sweat_exercise_today: COMPLETE_CHECK_IN_BODY.sweat_exercise_today,
        cycle_marker: COMPLETE_CHECK_IN_BODY.cycle_marker,
      }),
    );

    await service.updateEntryById('user-1', 'entry-1', {
      complaint_note: 'Still feels calm.',
    });

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        complaint_note: 'Still feels calm.',
        ratings: COMPLETE_CHECK_IN_BODY.ratings,
      }),
    );
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
      body: { skip_check_in: true },
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

  it('queues analysis with a durable DB job after photo upload', async () => {
    consents.findOne.mockResolvedValue({
      consent_type: UserConsentType.SkinProgressProcessing,
      granted: true,
      revoked_at: null,
    });

    await service.upsertEntryForResolvedDate({
      userId: 'user-1',
      targetDate: todayInTimeZone('UTC'),
      timeZone: 'UTC',
      photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
      body: { skip_check_in: true },
    });

    expect(analysisQueue.enqueueAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        reason: expect.stringContaining('photo upload'),
      }),
    );
    expect(analysis.analyze).not.toHaveBeenCalled();
  });

  it('keeps upload successful when durable queue creation is temporarily unavailable', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    consents.findOne.mockResolvedValue({
      consent_type: UserConsentType.SkinProgressProcessing,
      granted: true,
      revoked_at: null,
    });
    analysisQueue.enqueueAnalysisJob.mockRejectedValueOnce(
      new Error('database connection interrupted'),
    );

    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: todayInTimeZone('UTC'),
        timeZone: 'UTC',
        photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        body: { skip_check_in: true },
      }),
    ).resolves.toMatchObject({ id: 'entry-1' });
    loggerSpy.mockRestore();

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_status: 'queued',
        analysis_error: expect.stringContaining('retry automatically'),
      }),
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
        source_entry_ids: ['entry-1'],
      },
      {
        id: 'insight-other',
        user_id: 'user-1',
        kind: 'weekly',
        source_entry_ids: ['entry-other'],
      },
    ]);

    await service.upsertEntryForResolvedDate({
      userId: 'user-1',
      targetDate: todayInTimeZone('UTC'),
      timeZone: 'UTC',
      photo: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
      body: { skip_check_in: true },
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
        body: { skip_check_in: true },
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
        body: { skip_check_in: true },
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
      entry({
        entry_date: todayInTimeZone('UTC'),
        photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      }),
    );
    entries.delete.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.deleteEntry('user-1', 'entry-1')).rejects.toThrow(
      'database unavailable',
    );

    expect(photoStorage.deletePhoto).not.toHaveBeenCalled();
  });

  it('rejects deleting a journal entry once the local journal day has elapsed', async () => {
    entries.findOne.mockResolvedValue(
      entry({
        entry_date: '2026-04-29',
        time_zone: 'UTC',
        photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      }),
    );

    await expect(service.deleteEntry('user-1', 'entry-1')).rejects.toThrow(
      'Journal entries can only be changed on their local day',
    );

    expect(entries.delete).not.toHaveBeenCalled();
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

    await service.processInsightJob({
      user_id: 'user-1',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: insightInputSignature(entriesForTrend),
      attempt_count: 1,
      max_attempts: 5,
    } as SkinJournalInsightJob);

    expect(events.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'product_effectiveness' }),
    );
  });

  it('marks insight inputs dirty after analysis completes without saving insights inline', async () => {
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
    skinProfiles.findOne.mockResolvedValue(null);

    await service.runAnalysis('entry-current', 'user-1');

    expect(photoInterpretation.interpret).toHaveBeenCalledWith(
      expect.objectContaining({ model_version: 'test-model' }),
      expect.any(Date),
      expect.objectContaining({
        recentChange: null,
        skinContext: null,
      }),
    );
    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_interpretation: expect.objectContaining({
          summary_key: 'journal.analysis.interpretation.stableBaseline.summary',
        }),
      }),
    );
    expect(insightQueue.enqueueInsightJob).not.toHaveBeenCalled();
    expect(insightStates.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        dirty_reasons: ['photo_analysis_completed'],
        dirty_since: expect.any(Date),
        latest_input_signature: expect.any(String),
      }),
    );
    expect(insights.save).not.toHaveBeenCalled();
  });

  it('queues scheduled insight generation only after dirty inputs meet cadence', async () => {
    const entriesForInsights = Array.from({ length: 7 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        entry_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
        updated_at: new Date(
          `2026-04-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
        ),
      }),
    ).reverse();
    entries.find.mockResolvedValue(entriesForInsights);
    entries.count.mockResolvedValue(entriesForInsights.length);
    insightStates.findOne.mockResolvedValue({
      user_id: 'user-1',
      dirty_since: new Date('2026-04-20T09:00:00.000Z'),
      dirty_reasons: ['photo_analysis_completed'],
      latest_input_signature: insightInputSignature(entriesForInsights),
      latest_entry_count: entriesForInsights.length,
      last_generated_signature: null,
      last_generated_at: null,
      last_generation_trigger: null,
      last_checked_at: null,
    });

    await expect(service.generateInsightsIfNeeded('user-1')).resolves.toBe(
      true,
    );

    expect(insightQueue.enqueueInsightJob).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        trigger: 'scheduled_refresh',
        locale: 'en',
        inputSignature: insightInputSignature(entriesForInsights),
      }),
    );
  });

  it('does not queue scheduled insight generation while cadence is cooling down', async () => {
    const entriesForInsights = Array.from({ length: 8 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        entry_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
        updated_at: new Date(
          `2026-04-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
        ),
      }),
    ).reverse();
    entries.find.mockResolvedValue(entriesForInsights);
    entries.count.mockResolvedValue(entriesForInsights.length);
    insightStates.findOne.mockResolvedValue({
      user_id: 'user-1',
      dirty_since: new Date('2026-04-30T09:00:00.000Z'),
      dirty_reasons: ['check_in_updated'],
      latest_input_signature: insightInputSignature(entriesForInsights),
      latest_entry_count: entriesForInsights.length,
      last_generated_signature: 'previous-signature',
      last_generated_at: new Date(),
      last_generation_trigger: 'scheduled_refresh',
      last_checked_at: null,
    });

    await expect(service.generateInsightsIfNeeded('user-1')).resolves.toBe(
      false,
    );

    expect(insightQueue.enqueueInsightJob).not.toHaveBeenCalled();
    expect(insightStates.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        dirty_since: expect.any(Date),
        last_checked_at: expect.any(Date),
      }),
    );
  });

  it('does not immediately requeue the same failed insight input signature', async () => {
    const entriesForInsights = Array.from({ length: 8 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        entry_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
        updated_at: new Date(
          `2026-04-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
        ),
      }),
    ).reverse();
    const signature = insightInputSignature(entriesForInsights);
    entries.find.mockResolvedValue(entriesForInsights);
    entries.count.mockResolvedValue(entriesForInsights.length);
    insightStates.findOne.mockResolvedValue({
      user_id: 'user-1',
      dirty_since: new Date('2026-04-20T09:00:00.000Z'),
      dirty_reasons: ['scheduled_refresh'],
      latest_input_signature: signature,
      latest_entry_count: entriesForInsights.length,
      last_generated_signature: 'previous-signature',
      last_generated_at: new Date('2026-04-01T09:00:00.000Z'),
      last_generation_trigger: 'scheduled_refresh',
      last_failed_signature: signature,
      last_failed_at: new Date(),
      last_checked_at: null,
    });

    await expect(service.generateInsightsIfNeeded('user-1')).resolves.toBe(
      false,
    );

    expect(insightQueue.enqueueInsightJob).not.toHaveBeenCalled();
  });

  it('clears dirty insight state after a scheduled insight job completes', async () => {
    const entriesForInsights = Array.from({ length: 7 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        entry_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
      }),
    ).reverse();
    entries.find.mockResolvedValue(entriesForInsights);
    entries.count.mockResolvedValue(entriesForInsights.length);
    insights.findOne.mockResolvedValue(null);
    insightStates.findOne.mockResolvedValue({
      user_id: 'user-1',
      dirty_since: new Date('2026-04-20T09:00:00.000Z'),
      dirty_reasons: ['photo_analysis_completed'],
      latest_input_signature: insightInputSignature(entriesForInsights),
      latest_entry_count: entriesForInsights.length,
      last_generated_signature: null,
      last_generated_at: null,
      last_generation_trigger: null,
      last_checked_at: null,
    });

    await service.processInsightJob({
      user_id: 'user-1',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: insightInputSignature(entriesForInsights),
      attempt_count: 1,
      max_attempts: 5,
    } as SkinJournalInsightJob);

    expect(insightStates.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        dirty_since: null,
        dirty_reasons: [],
        last_generated_signature: insightInputSignature(entriesForInsights),
        last_generation_trigger: 'scheduled_refresh',
      }),
    );
  });

  it('does not generate AI sourced insight cards when the user disables AI refined insights', async () => {
    notifications.getPreferences.mockResolvedValueOnce({
      ai_polished_insights_enabled: false,
    });
    const entriesForInsights = Array.from({ length: 14 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        entry_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
        ratings: { redness: 2, breakouts: 2 },
        recent_change:
          index === 2 || index === 9 ? { kind: 'travelled' } : null,
      }),
    ).reverse();
    entries.find.mockResolvedValue(entriesForInsights);
    insights.findOne.mockResolvedValue(null);

    await service.processInsightJob({
      user_id: 'user-1',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: insightInputSignature(entriesForInsights),
      attempt_count: 1,
      max_attempts: 5,
    } as SkinJournalInsightJob);

    const savedKinds = insights.save.mock.calls.map(
      ([candidate]) => candidate.kind as string,
    );
    expect(savedKinds).not.toContain('ai_summary');
    expect(savedKinds).not.toContain('ai_pattern');
    expect(insightPolish.polish).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ aiPolishEnabled: false }),
    );
  });

  it('passes privacy-filtered profile context, check-in context, and previous photo into analysis', async () => {
    const previous = entry({
      id: 'entry-previous',
      entry_date: '2026-04-09',
      photo_object_key: 'skin-journal/user-1/entry-previous/photo.webp',
      analysis_status: 'completed',
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
          reaction_detected: false,
          reaction_severity: 'none',
          indicators: [],
          confidence: 0.1,
        },
        barrier_signs: { barrier_compromise: false, indicators: [] },
        overall_assessment: 'Previous redness appeared mild.',
        should_flag_for_doctor: false,
      },
    });
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-10',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'pending',
      concern_focus: ['redness', 'texture'],
      ratings: { redness: 4, irritation: 3, sensitivity: 4 },
      overall_feel: 'bad',
      sleep_band: '5to7h',
      stress_today: 'high',
      sun_exposure_today: 'brief',
      sweat_exercise_today: false,
      cycle_marker: 'dont_track',
      recent_change: {
        kind: 'started_new_product',
        related_inventory_product_id: 'inventory-1',
        note: 'retinoid',
      },
      complaint_note: 'Burning feeling near cheeks',
    });
    entries.findOne.mockResolvedValue(current);
    entries.find
      .mockResolvedValueOnce([previous])
      .mockResolvedValue([previous, current]);
    skinProfiles.findOne.mockResolvedValue({
      user_id: 'user-1',
      skin_type: 'combination',
      skin_tone: 'medium_deep',
      ethnicity: 'private-value',
      country_code: 'SE',
      city: 'Stockholm',
      fitzpatrick_phototype: 'V',
      sensitivity_level: 'high',
      hydration_level: 'low',
      current_concerns: ['redness', 'texture'],
      concern_details: {
        per_concern: [
          {
            concern: 'redness',
            severity: 'high',
            locations: ['cheeks'],
            subtype: 'diffuse',
            priority: 1,
            triggers: ['private-trigger'],
          },
        ],
      },
    });

    await service.runAnalysis(current.id, 'user-1');

    expect(analysis.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        entryId: 'entry-current',
        photoObjectKey: 'skin-journal/user-1/entry-current/photo.webp',
        priorPhotoObjectKey: 'skin-journal/user-1/entry-previous/photo.webp',
        priorAnalysis: previous.analysis_observations,
        concernFocus: ['redness', 'texture'],
        skinContext: expect.objectContaining({
          skin_type: 'combination',
          skin_tone: 'medium_deep',
          fitzpatrick_phototype: 'V',
          sensitivity_level: 'high',
          hydration_level: 'low',
          current_concerns: ['redness', 'texture'],
        }),
        entryContext: expect.objectContaining({
          entry_date: '2026-04-10',
          ratings: { redness: 4, irritation: 3, sensitivity: 4 },
          overall_feel: 'bad',
          sleep_band: '5to7h',
          stress_today: 'high',
          sun_exposure_today: 'brief',
          sweat_exercise_today: false,
          cycle_marker: 'dont_track',
          recent_change_kind: 'started_new_product',
          complaint_note: 'Burning feeling near cheeks',
          is_pre_routine: true,
        }),
      }),
    );
    const call = analysis.analyze.mock.calls.at(-1)?.[0] as {
      skinContext?: Record<string, unknown> | null;
    };
    expect(call.skinContext).not.toHaveProperty('ethnicity');
    expect(call.skinContext).not.toHaveProperty('country_code');
    expect(call.skinContext).not.toHaveProperty('city');
    expect(photoInterpretation.interpret).toHaveBeenCalledWith(
      expect.objectContaining({ model_version: 'test-model' }),
      expect.any(Date),
      expect.objectContaining({
        skinContext: expect.objectContaining({
          skin_tone: 'medium_deep',
          fitzpatrick_phototype: 'V',
        }),
        recentChange: current.recent_change,
      }),
    );
  });

  it('uses the most recent completed prior photo that is trend-safe as analysis baseline', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-10',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'pending',
    });
    const retakePrior = entry({
      id: 'entry-retake',
      entry_date: '2026-04-09',
      photo_object_key: 'skin-journal/user-1/entry-retake/photo.webp',
      analysis_status: 'needs_review',
      analysis_observations: {
        schema_version: '1.1',
        model_version: 'test-model',
        image_quality: {
          face_detected: true,
          lighting_quality: 'poor',
          framing_quality: 'good',
          blur_detected: false,
          issues: ['too_dark'],
          needs_retake: true,
          quality_score: 0.3,
          excluded_from_trends_reason: 'poor_lighting',
        },
        detected_concerns: [],
        reaction_signals: {
          reaction_detected: false,
          reaction_severity: 'none',
          indicators: [],
          confidence: 0.1,
        },
        barrier_signs: { barrier_compromise: false, indicators: [] },
        overall_assessment: 'Too dark to compare.',
        should_flag_for_doctor: false,
      },
    });
    const goodPrior = entry({
      id: 'entry-good',
      entry_date: '2026-04-08',
      photo_object_key: 'skin-journal/user-1/entry-good/photo.webp',
      analysis_status: 'completed',
      analysis_observations: {
        schema_version: '1.1',
        model_version: 'test-model',
        image_quality: {
          face_detected: true,
          lighting_quality: 'good',
          framing_quality: 'good',
          blur_detected: false,
          issues: [],
          needs_retake: false,
          quality_score: 0.9,
          excluded_from_trends_reason: null,
        },
        detected_concerns: [],
        reaction_signals: {
          reaction_detected: false,
          reaction_severity: 'none',
          indicators: [],
          confidence: 0.1,
        },
        barrier_signs: { barrier_compromise: false, indicators: [] },
        overall_assessment: 'Comparable baseline.',
        should_flag_for_doctor: false,
      },
    });
    entries.findOne.mockResolvedValue(current);
    entries.find
      .mockResolvedValueOnce([retakePrior, goodPrior])
      .mockResolvedValue([goodPrior, retakePrior, current]);

    await service.runAnalysis(current.id, 'user-1');

    expect(analysis.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        priorPhotoObjectKey: 'skin-journal/user-1/entry-good/photo.webp',
        priorAnalysis: goodPrior.analysis_observations,
      }),
    );
  });

  it('marks analysis as needs_review when the model asks for a retake', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-10',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'pending',
    });
    entries.findOne.mockResolvedValue(current);
    analysis.analyze.mockResolvedValueOnce(
      analysisRunResult(
        {
          schema_version: '1.1',
          model_version: 'test-model',
          image_quality: {
            face_detected: true,
            lighting_quality: 'poor',
            framing_quality: 'fair',
            blur_detected: false,
            issues: ['too_dark'],
            quality_score: 0.32,
            needs_retake: true,
            excluded_from_trends_reason: 'poor_lighting',
          },
          detected_concerns: [],
          reaction_signals: {
            reaction_detected: false,
            reaction_severity: 'none',
            indicators: [],
            confidence: 0.1,
          },
          barrier_signs: { barrier_compromise: false, indicators: [] },
          overall_assessment: 'Photo is too dark for a reliable check.',
          overall_change_from_previous: 'unknown',
          user_visible_message: 'Try another photo in natural daylight.',
          safety_flags: {
            urgent_review_recommended: false,
            doctor_follow_up_recommended: false,
            reasons: [],
          },
          should_flag_for_doctor: false,
        },
        {
          prompt_version: 'skin-journal-photo-vtest',
          duration_ms: 47,
          input_image_count: 2,
          input_tokens: 1500,
          output_tokens: 120,
          total_tokens: 1620,
          estimated_cost_usd: 0.0093,
        },
      ),
    );

    await service.runAnalysis(current.id, 'user-1');

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'entry-current',
        analysis_status: 'needs_review',
        analysis_prompt_version: 'skin-journal-photo-vtest',
        analysis_duration_ms: 47,
        analysis_input_image_count: 2,
        analysis_input_tokens: 1500,
        analysis_output_tokens: 120,
        analysis_total_tokens: 1620,
        analysis_estimated_cost_usd: 0.0093,
      }),
    );
  });

  it('cancels active analysis jobs when deleting an entry', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: todayInTimeZone('UTC'),
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'queued',
    });
    entries.findOne.mockResolvedValue(current);

    await service.deleteEntry('user-1', 'entry-current');

    expect(analysisQueue.cancelActiveJobsForEntry).toHaveBeenCalledWith(
      'entry-current',
      'Journal entry was deleted.',
    );
  });

  it('requeues interrupted pending/running analysis work after process restart', async () => {
    const interrupted = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'running',
    });
    entries.find.mockResolvedValue([interrupted]);

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
    expect(analysisQueue.recoverExpiredLocks).toHaveBeenCalled();
    expect(analysisQueue.enqueueAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        entryId: 'entry-current',
        photoObjectKey: 'skin-journal/user-1/entry-current/photo.webp',
        reason: expect.stringContaining('restart'),
        runAfter: expect.any(Date),
      }),
    );
  });

  it('skips interrupted analysis recovery when the durable queue schema is not ready', async () => {
    analysisQueue.isReady.mockResolvedValueOnce(false);

    await (
      service as SkinJournalService & {
        recoverInterruptedAnalyses: () => Promise<void>;
      }
    ).recoverInterruptedAnalyses();

    expect(analysisQueue.recoverExpiredLocks).not.toHaveBeenCalled();
    expect(entries.find).not.toHaveBeenCalled();
    expect(analysisQueue.enqueueAnalysisJob).not.toHaveBeenCalled();
  });

  it('completes the durable analysis job after a successful worker run', async () => {
    const current = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'queued',
    });
    entries.findOne.mockResolvedValue(current);

    await service.processAnalysisJob({
      id: 'analysis-job-1',
      user_id: 'user-1',
      entry_id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      status: 'running',
      attempt_count: 1,
      max_attempts: 5,
      run_after: new Date(),
      locked_at: new Date(),
      locked_by: 'worker-1',
      last_error: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      user: undefined as never,
      entry: undefined as never,
      generateId: jest.fn(),
    });

    expect(analysisQueue.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analysis-job-1' }),
    );
  });

  it('cancels stale durable jobs when the photo has been replaced', async () => {
    entries.findOne.mockResolvedValue(
      entry({
        id: 'entry-current',
        photo_object_key: 'skin-journal/user-1/entry-current/new.webp',
      }),
    );

    await service.processAnalysisJob({
      id: 'analysis-job-stale',
      user_id: 'user-1',
      entry_id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/old.webp',
      status: 'running',
      attempt_count: 1,
      max_attempts: 5,
      run_after: new Date(),
      locked_at: new Date(),
      locked_by: 'worker-1',
      last_error: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      user: undefined as never,
      entry: undefined as never,
      generateId: jest.fn(),
    });

    expect(analysisQueue.cancelJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analysis-job-stale' }),
      expect.stringContaining('replaced'),
    );
    expect(analysis.analyze).not.toHaveBeenCalled();
  });

  it('reschedules a durable job after a temporary analysis failure', async () => {
    const current = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'queued',
    });
    entries.findOne.mockResolvedValue(current);
    analysis.analyze.mockRejectedValueOnce(new Error('OpenAI timeout'));

    await service.processAnalysisJob({
      id: 'analysis-job-retry',
      user_id: 'user-1',
      entry_id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      status: 'running',
      attempt_count: 1,
      max_attempts: 5,
      run_after: new Date(),
      locked_at: new Date(),
      locked_by: 'worker-1',
      last_error: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      user: undefined as never,
      entry: undefined as never,
      generateId: jest.fn(),
    });

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_status: 'queued',
        analysis_error: 'OpenAI timeout',
      }),
    );
    expect(analysisQueue.rescheduleJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analysis-job-retry' }),
      {
        reason: 'OpenAI timeout',
        runAfter: new Date('2026-04-30T00:01:00.000Z'),
      },
    );
    expect(analysisQueue.failJob).not.toHaveBeenCalled();
  });

  it('marks the durable job and entry failed after max attempts', async () => {
    const current = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'queued',
    });
    entries.findOne.mockResolvedValue(current);
    analysis.analyze.mockRejectedValueOnce(
      new Error('Schema validation failed'),
    );

    await service.processAnalysisJob({
      id: 'analysis-job-failed',
      user_id: 'user-1',
      entry_id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      status: 'running',
      attempt_count: 5,
      max_attempts: 5,
      run_after: new Date(),
      locked_at: new Date(),
      locked_by: 'worker-1',
      last_error: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      user: undefined as never,
      entry: undefined as never,
      generateId: jest.fn(),
    });

    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis_status: 'failed',
        analysis_error: 'Schema validation failed',
      }),
    );
    expect(analysisQueue.failJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analysis-job-failed' }),
      'Schema validation failed',
    );
    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'analysis_failed' }),
    );
  });

  it('cancels durable jobs whose entry no longer exists', async () => {
    entries.findOne.mockResolvedValue(null);

    await service.processAnalysisJob({
      id: 'analysis-job-missing',
      user_id: 'user-1',
      entry_id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      status: 'running',
      attempt_count: 1,
      max_attempts: 5,
      run_after: new Date(),
      locked_at: new Date(),
      locked_by: 'worker-1',
      last_error: null,
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      user: undefined as never,
      entry: undefined as never,
      generateId: jest.fn(),
    });

    expect(analysisQueue.cancelJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analysis-job-missing' }),
      expect.stringContaining('no longer exists'),
    );
    expect(analysis.analyze).not.toHaveBeenCalled();
  });

  it('returns aggregate queue operations metrics without user payloads', async () => {
    analysisQueue.getQueueMetrics.mockResolvedValueOnce({
      driver: 'sqs',
      queued_count: 2,
      sent_count: 1,
      running_count: 1,
      failed_count: 1,
      completed_count: 10,
      cancelled_count: 1,
      oldest_queued_age_seconds: 1200,
      retrying_count: 1,
      sqs_visible_count: 3,
      sqs_not_visible_count: 1,
      sqs_oldest_message_age_seconds: 900,
      sqs_redrive_policy_configured: true,
      dlq_visible_count: 1,
      dlq_oldest_message_age_seconds: 60,
    });
    entries.find.mockResolvedValue([
      entry({
        id: 'entry-ok',
        analysis_status: 'completed',
        analysis_started_at: new Date(),
        analysis_duration_ms: 100,
        analysis_total_tokens: 1000,
        analysis_estimated_cost_usd: 0.01,
      }),
      entry({
        id: 'entry-failed',
        analysis_status: 'failed',
        analysis_started_at: new Date(),
        analysis_duration_ms: 300,
        analysis_total_tokens: 500,
        analysis_estimated_cost_usd: 0.02,
      }),
    ]);

    const result = await service.getAnalysisQueueOperations(
      'ops-token-123456789012345678901234',
    );

    expect(result.queue.queued_count).toBe(2);
    expect(result.analysis.average_duration_ms).toBe(200);
    expect(result.analysis.total_tokens).toBe(1500);
    expect(result.alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining([
        'analysis_queue_oldest_job_age_high',
        'analysis_failure_rate_high',
        'analysis_dlq_not_empty',
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('user-1');
    expect(JSON.stringify(result)).not.toContain('photo.webp');
  });

  it('rejects operations metrics without the private operations token', async () => {
    await expect(
      service.getAnalysisQueueOperations('wrong-token'),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
    insights.findOne.mockResolvedValue({
      id: 'insight-dismissed',
      user_id: 'user-1',
      generated_at: new Date('2026-04-10T09:00:00.000Z'),
      kind: 'daily',
      insight_signature: 'existing-signature',
      source_entry_ids: ['entry-current'],
      severity: 'info',
      seen_at: null,
      dismissed_at: new Date('2026-04-10T10:00:00.000Z'),
    });
    const insightNotificationsBefore = notifications.dispatch.mock.calls.filter(
      ([payload]) => payload.kind === 'insight_ready',
    ).length;

    await service.processInsightJob({
      user_id: 'user-1',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: insightInputSignature([current]),
      attempt_count: 1,
      max_attempts: 5,
    } as SkinJournalInsightJob);

    expect(insights.save).not.toHaveBeenCalled();
    const insightNotificationsAfter = notifications.dispatch.mock.calls.filter(
      ([payload]) => payload.kind === 'insight_ready',
    ).length;
    expect(insightNotificationsAfter).toBe(insightNotificationsBefore);
  });

  it('treats concurrent duplicate insight signatures as an idempotent skip', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-10',
      analysis_status: 'skipped',
    });
    entries.find.mockResolvedValue([current]);
    insights.findOne.mockResolvedValue(null);
    insights.save.mockRejectedValueOnce(
      Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          code: '23505',
        },
      ),
    );

    await expect(
      service.processInsightJob({
        user_id: 'user-1',
        trigger: 'scheduled_refresh',
        locale: 'en',
        input_signature: insightInputSignature([current]),
        attempt_count: 1,
        max_attempts: 5,
      } as SkinJournalInsightJob),
    ).resolves.toBeUndefined();

    expect(notifications.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'insight_ready' }),
    );
    expect(insightRuns.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('rejects invalid date filters before listing photos or comparing dates', async () => {
    await expect(
      service.listPhotos('user-1', { from: '2026-02-31' }),
    ).rejects.toThrow('Invalid from date');

    await expect(
      service.getCompare('user-1', '2026-04-01', '2026-02-31'),
    ).rejects.toThrow('Invalid date');
  });

  it('builds photo filters from saved backend analysis data', async () => {
    entries.find.mockResolvedValue([
      entry({
        id: 'entry-reaction',
        photo_object_key: 'skin-journal/user-1/entry-reaction/photo.webp',
        analysis_concern_keys: ['acne', 'redness_inflammation'],
        has_reaction_signal: true,
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
          detected_concerns: [
            {
              concern: 'acne',
              severity: 'mild',
              locations: ['chin'],
              confidence: 0.7,
            },
            {
              concern: 'redness_inflammation',
              severity: 'moderate',
              locations: ['left_cheek'],
              confidence: 0.8,
            },
          ],
          reaction_signals: {
            reaction_detected: true,
            reaction_severity: 'moderate',
            indicators: ['redness_spike'],
            confidence: 0.8,
          },
          barrier_signs: { barrier_compromise: false, indicators: [] },
          overall_assessment: 'Possible irritation.',
          should_flag_for_doctor: false,
        },
      }),
      entry({
        id: 'entry-acne',
        photo_object_key: 'skin-journal/user-1/entry-acne/photo.webp',
        analysis_concern_keys: ['acne'],
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
          detected_concerns: [
            {
              concern: 'acne',
              severity: 'mild',
              locations: ['chin'],
              confidence: 0.7,
            },
          ],
          reaction_signals: {
            reaction_detected: false,
            reaction_severity: 'none',
            indicators: [],
            confidence: 0.1,
          },
          barrier_signs: { barrier_compromise: false, indicators: [] },
          overall_assessment: 'Looks stable.',
          should_flag_for_doctor: false,
        },
      }),
    ]);

    const result = await service.listPhotoFilters('user-1', {});

    expect(result.filters).toEqual([
      { id: 'all', kind: 'all', value: null, count: 2 },
      { id: 'reaction', kind: 'reaction', value: null, count: 1 },
      { id: 'concern:acne', kind: 'concern', value: 'acne', count: 2 },
      {
        id: 'concern:redness_inflammation',
        kind: 'concern',
        value: 'redness_inflammation',
        count: 1,
      },
    ]);
    expect(photoStorage.getSignedUrl).not.toHaveBeenCalled();
  });

  it('filters journal photos on the server by backend analysis concern', async () => {
    const acneEntry = entry({
      id: 'entry-acne',
      photo_object_key: 'skin-journal/user-1/entry-acne/photo.webp',
      analysis_concern_keys: ['acne'],
    });
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([acneEntry]),
    };
    entries.createQueryBuilder.mockReturnValue(queryBuilder);

    const result = await service.listPhotos('user-1', {
      filter: 'concern:acne',
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      ':concern = ANY(entry.analysis_concern_keys)',
      { concern: 'acne' },
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('entry-acne');
    expect(result.nextCursor).toBeNull();
  });

  it('rejects unknown photo filters before reading signed media URLs', async () => {
    await expect(
      service.listPhotos('user-1', { filter: 'concern:not_supported' }),
    ).rejects.toThrow('Invalid photo filter');

    expect(photoStorage.getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns a lightweight photo-date index across years grouped by month', async () => {
    entries.find.mockResolvedValue([
      entry({
        id: 'entry-2026-04',
        entry_date: '2026-04-10',
        photo_object_key: 'skin-journal/user-1/entry-2026-04/photo.webp',
        analysis_status: 'completed',
      }),
      entry({
        id: 'entry-2025-12-a',
        entry_date: '2025-12-31',
        photo_object_key: 'skin-journal/user-1/entry-2025-12-a/photo.webp',
        analysis_status: 'failed',
      }),
      entry({
        id: 'entry-2025-12-b',
        entry_date: '2025-12-01',
        photo_object_key: 'skin-journal/user-1/entry-2025-12-b/photo.webp',
        has_reaction_signal: true,
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
          barrier_signs: { barrier_compromise: false, indicators: [] },
          overall_assessment: 'Possible irritation.',
          should_flag_for_doctor: false,
        },
      }),
    ]);

    const result = await service.listPhotoDates('user-1', {});

    expect(result.dates).toEqual([
      {
        date: '2026-04-10',
        entry_id: 'entry-2026-04',
        analysis_status: 'completed',
        has_reaction: false,
      },
      {
        date: '2025-12-31',
        entry_id: 'entry-2025-12-a',
        analysis_status: 'failed',
        has_reaction: false,
      },
      {
        date: '2025-12-01',
        entry_id: 'entry-2025-12-b',
        analysis_status: 'skipped',
        has_reaction: true,
      },
    ]);
    expect(result.months).toEqual([
      { month: '2026-04', photo_count: 1 },
      { month: '2025-12', photo_count: 2 },
    ]);
    expect(photoStorage.getSignedUrl).not.toHaveBeenCalled();
  });

  it('validates photo-date index filters', async () => {
    await expect(
      service.listPhotoDates('user-1', { from: '2026-02-31' }),
    ).rejects.toThrow('Invalid from date');

    await expect(
      service.listPhotoDates('user-1', {
        from: '2026-04-30',
        to: '2026-04-01',
      }),
    ).rejects.toThrow('Date range must start before it ends');
  });

  it('requires compare dates to be distinct uploaded-photo dates', async () => {
    await expect(
      service.getCompare('user-1', '2026-04-10', '2026-04-10'),
    ).rejects.toThrow('Compare dates must be different');

    entries.findOne
      .mockResolvedValueOnce(
        entry({
          id: 'from-entry',
          entry_date: '2026-04-10',
          photo_object_key: 'skin-journal/user-1/from-entry/photo.webp',
        }),
      )
      .mockResolvedValueOnce(null);

    await expect(
      service.getCompare('user-1', '2026-04-10', '2026-04-11'),
    ).rejects.toThrow('Both compare dates must have uploaded photos');

    entries.findOne
      .mockResolvedValueOnce(
        entry({
          id: 'from-entry',
          entry_date: '2026-04-10',
          photo_object_key: 'skin-journal/user-1/from-entry/photo.webp',
        }),
      )
      .mockResolvedValueOnce(
        entry({
          id: 'photo-less-entry',
          entry_date: '2026-04-11',
          photo_object_key: null,
        }),
      );

    await expect(
      service.getCompare('user-1', '2026-04-10', '2026-04-11'),
    ).rejects.toThrow('Both compare dates must have uploaded photos');
  });

  it('returns structured compare delta codes instead of backend English copy', async () => {
    entries.findOne
      .mockResolvedValueOnce(
        entry({
          id: 'from-entry',
          entry_date: '2026-04-10',
          photo_object_key: 'skin-journal/user-1/from-entry/photo.webp',
          ratings: { redness: 4, breakouts: 2 },
          has_reaction_signal: true,
        }),
      )
      .mockResolvedValueOnce(
        entry({
          id: 'to-entry',
          entry_date: '2026-04-11',
          photo_object_key: 'skin-journal/user-1/to-entry/photo.webp',
          ratings: { redness: 2, breakouts: 3 },
          has_reaction_signal: false,
        }),
      );

    const result = await service.getCompare(
      'user-1',
      '2026-04-10',
      '2026-04-11',
    );

    expect(result.delta.bullets).toEqual([
      {
        code: 'rating_improved',
        tone: 'good',
        concern: 'redness',
        from_rating: 4,
        to_rating: 2,
      },
      {
        code: 'rating_worsened',
        tone: 'warn',
        concern: 'breakouts',
        from_rating: 2,
        to_rating: 3,
      },
      { code: 'reaction_cleared', tone: 'good' },
    ]);
    expect(result.delta.bullets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.any(String) }),
      ]),
    );
  });
});
