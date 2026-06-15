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
import { AccountMonitoringEvent } from '../users/entities/account-monitoring-event.entity';
import { User } from '../users/entities/user.entity';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import { UserConsentType } from '../users/user-consent.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { RoutineMemoryService } from '../routine-memory/routine-memory.service';
import { SmartPicksPreparationService } from '../smart-picks/services/smart-picks-preparation.service';
import {
  SkinProfileWaterHardness,
  SkinProfileWaterSensitivity,
} from '../skin-profile/dto/skin-profile.constants';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { SkinJournalEntryPhoto } from './entities/skin-journal-entry-photo.entity';
import { SkinJournalEvent } from './entities/skin-journal-event.entity';
import { SkinJournalInsight } from './entities/skin-journal-insight.entity';
import { SkinJournalAnalysisFeedback } from './entities/skin-journal-analysis-feedback.entity';
import { SkinJournalInsightInteraction } from './entities/skin-journal-insight-interaction.entity';
import { SkinJournalInsightGenerationRun } from './entities/skin-journal-insight-generation-run.entity';
import { SkinJournalInsightJob } from './entities/skin-journal-insight-job.entity';
import { SkinJournalInsightState } from './entities/skin-journal-insight-state.entity';
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { RoutineStep } from '../schedule/entities/routine-step.entity';
import { SkinJournalAnalysisService } from './services/skin-journal-analysis.service';
import { SkinJournalPhotoInterpretationService } from './services/skin-journal-photo-interpretation.service';
import { SkinJournalAnalysisQueueService } from './services/skin-journal-analysis-queue.service';
import { SkinJournalInsightQueueService } from './services/skin-journal-insight-queue.service';
import { SkinJournalMediaRetentionService } from './services/skin-journal-media-retention.service';
import {
  InsightPolishService,
  type InsightPolishRunResult,
} from './insights/insight-polish.service';
import type { InsightCandidate } from './insights/insight-types';
import { KnowledgeBaseService } from './insights/knowledge-base/knowledge-base.service';
import { SkinJournalPhotoStorageService } from './services/skin-journal-photo-storage.service';
import {
  AnalysisFailureCodeValue,
  AnalysisObservations,
  SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
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
  manager: {
    transaction: jest.fn(),
  },
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
    analysis_feedback_submitted: false,
    analysis_feedback_submitted_at: null,
    analysis_feedback_interpretation_version: null,
    analysis_concern_keys: [],
    has_reaction_signal: false,
    needs_retake: false,
    analysis_summary: null,
    analysis_model: null,
    analysis_version: null,
    analysis_prompt_version: null,
    analysis_error: null,
    analysis_error_code: null,
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
    reaction_report: overrides.reaction_report ?? null,
  };
}

function photoRow(
  overrides: Partial<SkinJournalEntryPhoto> = {},
): SkinJournalEntryPhoto {
  return {
    id: 'photo-1',
    user_id: 'user-1',
    entry_id: 'entry-1',
    angle: 'head_on',
    photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
    photo_width: 100,
    photo_height: 100,
    photo_size: 10,
    photo_content_type: 'image/webp',
    exif_stripped: true,
    created_at: new Date('2026-04-29T00:00:00.000Z'),
    updated_at: new Date('2026-04-29T00:00:00.000Z'),
    user: undefined as never,
    entry: undefined as never,
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

function analyzedObservations(
  overrides: Partial<AnalysisObservations> = {},
): AnalysisObservations {
  return {
    schema_version: '1.1',
    model_version: 'test-model',
    image_quality: {
      face_detected: true,
      lighting_quality: 'good',
      framing_quality: 'good',
      blur_detected: false,
      issues: [],
      quality_score: 0.9,
      needs_retake: false,
      excluded_from_trends_reason: null,
    },
    detected_concerns: [
      {
        concern: 'acne',
        severity: 'moderate',
        locations: ['chin'],
        confidence: 0.78,
      },
    ],
    reaction_signals: {
      reaction_detected: false,
      reaction_severity: 'none',
      indicators: [],
      confidence: 0.1,
    },
    barrier_signs: { barrier_compromise: false, indicators: [] },
    overall_assessment: 'Visible breakout activity.',
    overall_change_from_previous: 'unknown',
    user_visible_message: 'Visible breakout activity.',
    safety_flags: {
      urgent_review_recommended: false,
      doctor_follow_up_recommended: false,
      reasons: [],
    },
    should_flag_for_doctor: false,
    ...overrides,
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
      ...(item.reaction_report
        ? { reaction_report: item.reaction_report }
        : {}),
      complaint_note: item.complaint_note,
    }));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function expectNotificationDedupeKey(kind: string) {
  return expect.stringMatching(new RegExp(`^${kind}:[a-f0-9]{32}$`));
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
    lifestyle_context: {
      water_hardness: SkinProfileWaterHardness.Unknown,
      water_sensitivity: SkinProfileWaterSensitivity.None,
    },
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
  let users: ReturnType<typeof repo>;
  let entryPhotos: ReturnType<typeof repo>;
  let events: ReturnType<typeof repo>;
  let insights: ReturnType<typeof repo>;
  let insightInteractions: ReturnType<typeof repo>;
  let analysisFeedback: ReturnType<typeof repo>;
  let applicationLogs: ReturnType<typeof repo>;
  let inventoryProducts: ReturnType<typeof repo>;
  let routineSteps: ReturnType<typeof repo>;
  let insightRuns: ReturnType<typeof repo>;
  let insightStates: ReturnType<typeof repo>;
  let wrapped: ReturnType<typeof repo>;
  let simplifications: ReturnType<typeof repo>;
  let consents: ReturnType<typeof repo>;
  let accountMonitoringEvents: ReturnType<typeof repo>;
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
      source_ids: [] as string[],
      sources: [] as unknown[],
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
  const smartPicksPreparation = {
    scheduleForUser: jest.fn(),
  } as unknown as jest.Mocked<SmartPicksPreparationService>;
  const routineMemory = {
    getTimeline: jest.fn(),
  } as unknown as jest.Mocked<Pick<RoutineMemoryService, 'getTimeline'>>;
  type InsightPolishOptions = { locale: string; aiPolishEnabled: boolean };
  const insightPolish = {
    polish: jest.fn<
      Promise<InsightCandidate[]>,
      [InsightCandidate[], InsightPolishOptions]
    >(async (candidates) => candidates),
    polishWithUsage: jest.fn<
      Promise<InsightPolishRunResult>,
      [InsightCandidate[], InsightPolishOptions]
    >(async (candidates) => ({
      candidates,
      usage: null,
    })),
  };
  const knowledgeBase = {
    resolveMany: jest.fn(() => []),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'SKIN_JOURNAL_OPERATIONS_TOKEN') {
        return 'ops-token-123456789012345678901234';
      }
      return undefined;
    }),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'SKIN_JOURNAL_OPERATIONS_TOKEN') {
        return 'ops-token-123456789012345678901234';
      }
      throw new Error(`Missing config ${key}`);
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    entries = repo();
    users = repo();
    entryPhotos = repo();
    events = repo();
    insights = repo();
    insightInteractions = repo();
    analysisFeedback = repo();
    applicationLogs = repo();
    inventoryProducts = repo();
    routineSteps = repo();
    insightRuns = repo();
    insightStates = repo();
    wrapped = repo();
    simplifications = repo();
    consents = repo();
    skinProfiles = repo();
    entries.manager.transaction.mockImplementation(
      async (
        callback: (manager: {
          getRepository: (entity: unknown) => unknown;
        }) => Promise<unknown>,
      ) =>
        callback({
          getRepository: (entity: unknown) => {
            if (entity === SkinJournalEntry) return entries;
            if (entity === SkinJournalEntryPhoto) return entryPhotos;
            if (entity === SkinJournalAnalysisFeedback) return analysisFeedback;
            throw new Error('Unexpected transactional repository');
          },
        }),
    );
    skinProfiles.findOne.mockResolvedValue(completeSkinProfile());
    users.findOne.mockResolvedValue({ id: 'user-1', time_zone: 'UTC' });
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
    photoInterpretation.interpret.mockImplementation(() => ({
      version: '1.0',
      code: 'stable_baseline',
      severity: 'info',
      summary_key: 'journal.analysis.interpretation.stableBaseline.summary',
      summary_values: {},
      guidance_keys: [
        'journal.analysis.interpretation.stableBaseline.guidance',
      ],
      caveat_keys: ['journal.analysis.interpretation.caveats.notDiagnosis'],
      source_ids: [] as string[],
      sources: [] as unknown[],
      generated_at: '2026-05-01T08:00:00.000Z',
    }));
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
    smartPicksPreparation.scheduleForUser.mockClear();
    routineMemory.getTimeline.mockClear();
    routineMemory.getTimeline.mockResolvedValue({
      generatedAt: '2026-04-10T12:00:00.000Z',
      timeZone: 'UTC',
      window: {
        start: '2026-03-12',
        end: '2026-04-10',
        days: 30,
      },
      disclaimer:
        'Routine Memory shows timing patterns, not proof of what caused a reaction.',
      summary: {
        timelineEventCount: 3,
        productChangeCount: 1,
        applicationLogCount: 1,
        reactionSignalCount: 1,
        recoveryEventCount: 0,
        suspiciousProductCount: 1,
        hasPossibleLinks: true,
      },
      timeline: [
        {
          id: 'memory-event-1',
          date: '2026-04-08',
          occurredAt: '2026-04-08T18:00:00.000Z',
          type: 'first_logged_use',
          severity: 'info',
          product: {
            productId: 'inventory-1',
            brand: 'Test',
            name: 'Retinol Serum',
            category: 'serum',
            imageUrl: 'https://private.example.com/product.webp',
          },
          sourceType: 'application_log',
          sourceId: 'application-log-1',
        },
        {
          id: 'memory-event-2',
          date: '2026-04-10',
          occurredAt: '2026-04-10T08:00:00.000Z',
          type: 'reaction_signal',
          severity: 'warning',
          product: null,
          sourceType: 'skin_journal_entry',
          sourceId: 'entry-current',
        },
      ],
      suspiciousProducts: [
        {
          productId: 'inventory-1',
          brand: 'Test',
          name: 'Retinol Serum',
          category: 'serum',
          imageUrl: 'https://private.example.com/product.webp',
          suspicionLevel: 'possible',
          score: 5,
          reasonCodes: ['reaction_after_first_logged_use'],
          firstUseDate: '2026-04-08',
          lastUseDate: '2026-04-09',
          nearestReactionDate: '2026-04-10',
          daysFromFirstUseToReaction: 2,
          reactionSignalCountNearUse: 1,
        },
      ],
      productTimelines: [],
    });
    accountMonitoringEvents = repo();

    const module = await Test.createTestingModule({
      providers: [
        SkinJournalService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(SkinJournalEntry), useValue: entries },
        {
          provide: getRepositoryToken(SkinJournalEntryPhoto),
          useValue: entryPhotos,
        },
        { provide: getRepositoryToken(SkinJournalEvent), useValue: events },
        { provide: getRepositoryToken(SkinJournalInsight), useValue: insights },
        {
          provide: getRepositoryToken(SkinJournalInsightInteraction),
          useValue: insightInteractions,
        },
        {
          provide: getRepositoryToken(SkinJournalAnalysisFeedback),
          useValue: analysisFeedback,
        },
        {
          provide: getRepositoryToken(ApplicationLog),
          useValue: applicationLogs,
        },
        {
          provide: getRepositoryToken(InventoryProduct),
          useValue: inventoryProducts,
        },
        {
          provide: getRepositoryToken(RoutineStep),
          useValue: routineSteps,
        },
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
        { provide: getRepositoryToken(UserConsent), useValue: consents },
        { provide: getRepositoryToken(SkinProfile), useValue: skinProfiles },
        {
          provide: getRepositoryToken(AccountMonitoringEvent),
          useValue: accountMonitoringEvents,
        },
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
        {
          provide: SmartPicksPreparationService,
          useValue: smartPicksPreparation,
        },
        { provide: RoutineMemoryService, useValue: routineMemory },
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
        photos: {
          head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        },
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
        photos: {
          head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        },
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
        photos: {
          head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        },
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
    expect(smartPicksPreparation.scheduleForUser).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('starts Recovery Mode from a user-reported barrier reaction without photo analysis', async () => {
    await service.upsertEntryForResolvedDate({
      userId: 'user-1',
      targetDate: todayInTimeZone('UTC'),
      timeZone: 'UTC',
      body: {
        ...COMPLETE_CHECK_IN_BODY,
        reaction_report: {
          symptoms: ['burning', 'stinging'],
          severity: 'mild',
          onset: 'today',
          locations: ['cheeks'],
          red_flags: [],
          suspected_trigger: 'active_ingredient',
          note: 'Stinging after using actives twice this week.',
        },
      },
    });

    expect(simplifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        triggered_by_event_id: null,
        simplification_mode: 'barrier_repair',
        recovery_phase: 'stabilize',
        recovery_trigger_source: 'reaction_report',
        recovery_trigger_symptoms: ['burning', 'stinging'],
        recovery_trigger_severity: 'mild',
        recovery_active_overuse: true,
        recovery_return_step: 'not_started',
        restore_strategy: 'phased',
      }),
    );
    expect(simplifications.save).toHaveBeenCalled();
  });

  it('upgrades an existing active simplification with new Recovery Mode metadata', async () => {
    const existing = {
      id: 'simplification-1',
      user_id: 'user-1',
      triggered_by_event_id: null,
      started_at: new Date('2026-06-13T08:00:00.000Z'),
      ended_at: null,
      acknowledged_at: null,
      simplification_mode: 'barrier_repair',
      recovery_phase: 'stabilize',
      recovery_trigger_source: 'manual',
      recovery_trigger_symptoms: [],
      recovery_trigger_severity: null,
      recovery_active_overuse: false,
      recovery_review_after: null,
      recovery_exit_eligible_at: null,
      recovery_return_step: 'not_started',
      restore_strategy: 'full',
      original_schedule_snapshot: null,
      reason: 'Older active simplification.',
      triggered_by_event: null,
      generateId: jest.fn(),
    } as RoutineSimplificationEvent;
    simplifications.findOne.mockResolvedValue(existing);
    simplifications.save.mockImplementation(async (data) => data);

    await service.startSimplification({
      userId: 'user-1',
      triggeredByEventId: null,
      reason:
        'User-reported barrier symptoms started Recovery Mode with a phased return.',
      recoveryTriggerSource: 'reaction_report',
      recoveryTriggerSymptoms: ['burning'],
      recoveryTriggerSeverity: 'moderate',
      recoveryActiveOveruse: true,
      recoveryReviewAfter: new Date('2026-06-17T08:00:00.000Z'),
      recoveryExitEligibleAt: new Date('2026-06-19T08:00:00.000Z'),
    });

    expect(simplifications.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'simplification-1',
        recovery_trigger_source: 'reaction_report',
        recovery_trigger_symptoms: ['burning'],
        recovery_trigger_severity: 'moderate',
        recovery_active_overuse: true,
        recovery_review_after: new Date('2026-06-17T08:00:00.000Z'),
        recovery_exit_eligible_at: new Date('2026-06-19T08:00:00.000Z'),
        restore_strategy: 'phased',
      }),
    );
  });

  it('records helpfulness feedback for the current analysis interpretation', async () => {
    const analyzedEntry = entry({
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      analysis_status: 'completed',
      analysis_observations: analyzedObservations(),
      analysis_interpretation: {
        version: '1.1',
        code: 'acne_progress_timing',
        severity: 'info',
        summary_key:
          'journal.analysis.interpretation.acneProgressTiming.summary',
        summary_values: {},
        guidance_keys: [],
        caveat_keys: [],
        source_ids: [],
        sources: [],
        generated_at: '2026-05-01T08:00:00.000Z',
        reading_quality: {
          visual_label: 'useful',
          trend_label: 'limited',
          reason_keys: [],
        },
        concern_guidance: [],
      },
    });
    entries.findOne.mockResolvedValue(analyzedEntry);
    analysisFeedback.save.mockImplementation(async (feedback) => ({
      ...feedback,
      created_at: new Date('2026-05-01T08:00:00.000Z'),
      updated_at: new Date('2026-05-01T08:00:00.000Z'),
    }));

    await expect(
      service.recordAnalysisFeedback('user-1', 'entry-1', {
        note: 'This needed more context.',
        reason: 'too_generic',
        vote: 'not_helpful',
      }),
    ).resolves.toMatchObject({
      vote: 'not_helpful',
      reason: 'too_generic',
      note: 'This needed more context.',
      interpretation_version: '1.1',
      reading_label: 'useful',
    });

    expect(analysisFeedback.save).toHaveBeenCalledWith(
      expect.objectContaining({
        vote: 'not_helpful',
        reason: 'too_generic',
        note: 'This needed more context.',
        interpretation_version: '1.1',
        reading_label: 'useful',
        concern_keys: ['acne'],
      }),
    );
    expect(analysisFeedback.findOne).not.toHaveBeenCalled();
    expect(analysisFeedback.save).toHaveBeenCalledWith(
      expect.not.objectContaining({
        entry_id: expect.any(String),
        user_id: expect.any(String),
      }),
    );
    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'entry-1',
        analysis_feedback_submitted: true,
        analysis_feedback_submitted_at: expect.any(Date),
        analysis_feedback_interpretation_version: '1.1',
      }),
    );
  });

  it('requires a reason for not helpful analysis feedback', async () => {
    await expect(
      service.recordAnalysisFeedback('user-1', 'entry-1', {
        vote: 'not_helpful',
      }),
    ).rejects.toThrow('Not helpful analysis feedback requires a reason');
  });

  it('reinterprets an old analysis payload without rerunning external photo AI', async () => {
    const oldEntry = entry({
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      analysis_status: 'completed',
      analysis_observations: analyzedObservations(),
      analysis_interpretation: {
        version: '1.0',
        code: 'stable_baseline',
        severity: 'info',
        summary_key: 'journal.analysis.interpretation.stableBaseline.summary',
        summary_values: {},
        guidance_keys: [],
        caveat_keys: [],
        source_ids: [],
        sources: [],
        generated_at: '2026-04-01T08:00:00.000Z',
      },
      ratings: {
        breakouts: 5,
        oiliness: 3,
        dryness: 1,
        redness: 1,
        texture: 2,
        irritation: 1,
        sensitivity: 1,
      },
      overall_feel: 'bad',
      sleep_band: '5to7h',
      stress_today: 'high',
      sun_exposure_today: 'none',
      sweat_exercise_today: false,
      cycle_marker: 'dont_track',
    });
    entries.findOne.mockResolvedValue(oldEntry);
    entries.save.mockImplementation(async (saved) => saved);
    photoInterpretation.interpret.mockReturnValue({
      version: '1.1',
      code: 'acne_progress_timing',
      severity: 'info',
      summary_key: 'journal.analysis.interpretation.acneProgressTiming.summary',
      summary_values: {},
      guidance_keys: [
        'journal.analysis.interpretation.acneProgressTiming.guidance',
      ],
      caveat_keys: ['journal.analysis.interpretation.caveats.notDiagnosis'],
      source_ids: ['aad_acne_skin_care_tips'],
      sources: [],
      generated_at: '2026-05-01T08:00:00.000Z',
      reading_quality: {
        visual_label: 'useful',
        trend_label: 'limited',
        reason_keys: [],
      },
      concern_guidance: [],
    } as ReturnType<SkinJournalPhotoInterpretationService['interpret']>);

    await expect(
      service.reinterpretAnalysis('user-1', 'entry-1'),
    ).resolves.toMatchObject({
      id: 'entry-1',
      analysis_interpretation: expect.objectContaining({
        version: '1.1',
      }),
      analysis_summary:
        'journal.analysis.interpretation.acneProgressTiming.summary',
    });

    expect(analysis.analyze).not.toHaveBeenCalled();
    expect(photoInterpretation.interpret).toHaveBeenCalledWith(
      oldEntry.analysis_observations,
      expect.any(Date),
      expect.objectContaining({
        routineContext: expect.objectContaining({
          recent_check_ins: expect.arrayContaining([
            expect.objectContaining({
              ratings: expect.objectContaining({ breakouts: 5 }),
            }),
          ]),
        }),
      }),
    );
    expect(smartPicksPreparation.scheduleForUser).toHaveBeenCalledWith(
      'user-1',
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
      photos: {
        head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
      },
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

  it('stores a front-required multi-angle photo set and queues analysis from the front photo', async () => {
    consents.findOne.mockResolvedValue({
      consent_type: UserConsentType.SkinProgressProcessing,
      granted: true,
      revoked_at: null,
    });
    photoStorage.storePhoto
      .mockResolvedValueOnce({
        object_key: 'skin-journal/user-1/entry-1/front.webp',
        width: 120,
        height: 140,
        size: 12,
        content_type: 'image/webp',
        exif_stripped: true,
      })
      .mockResolvedValueOnce({
        object_key: 'skin-journal/user-1/entry-1/left.webp',
        width: 100,
        height: 100,
        size: 10,
        content_type: 'image/webp',
        exif_stripped: true,
      })
      .mockResolvedValueOnce({
        object_key: 'skin-journal/user-1/entry-1/right.webp',
        width: 100,
        height: 100,
        size: 10,
        content_type: 'image/webp',
        exif_stripped: true,
      });

    const response = await service.upsertEntryForResolvedDate({
      userId: 'user-1',
      targetDate: todayInTimeZone('UTC'),
      timeZone: 'UTC',
      photos: {
        head_on: { buffer: Buffer.from('front'), contentType: 'image/jpeg' },
        left_profile: {
          buffer: Buffer.from('left'),
          contentType: 'image/jpeg',
        },
        right_profile: {
          buffer: Buffer.from('right'),
          contentType: 'image/jpeg',
        },
      },
      body: {
        skip_check_in: true,
        photo_processing_consent: true,
      },
    });

    expect(photoStorage.storePhoto).toHaveBeenCalledTimes(3);
    expect(entries.manager.transaction).toHaveBeenCalled();
    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        photo_object_key: 'skin-journal/user-1/entry-1/front.webp',
        photo_width: 120,
        photo_height: 140,
      }),
    );
    expect(entryPhotos.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          angle: 'head_on',
          photo_object_key: 'skin-journal/user-1/entry-1/front.webp',
        }),
        expect.objectContaining({
          angle: 'left_profile',
          photo_object_key: 'skin-journal/user-1/entry-1/left.webp',
        }),
        expect.objectContaining({
          angle: 'right_profile',
          photo_object_key: 'skin-journal/user-1/entry-1/right.webp',
        }),
      ]),
    );
    expect(analysisQueue.enqueueAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        photoObjectKey: 'skin-journal/user-1/entry-1/front.webp',
      }),
    );
    expect(response.photo_url).toContain(
      'skin-journal/user-1/entry-1/front.webp',
    );
    expect(response.angle_count).toBe(3);
    expect(response.has_side_photos).toBe(true);
    expect(response.photos.map((photo) => photo.angle)).toEqual([
      'left_profile',
      'head_on',
      'right_profile',
    ]);
  });

  it('rejects side photo uploads when the entry would not have a front photo', async () => {
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
        photos: {
          left_profile: {
            buffer: Buffer.from('left'),
            contentType: 'image/jpeg',
          },
        },
        body: {
          skip_check_in: true,
          photo_processing_consent: true,
        },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(photoStorage.storePhoto).not.toHaveBeenCalled();
    expect(entries.save).not.toHaveBeenCalled();
    expect(entryPhotos.save).not.toHaveBeenCalled();
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
      photos: {
        head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
      },
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
    expect(smartPicksPreparation.scheduleForUser).toHaveBeenCalledWith(
      'user-1',
    );
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
        photos: {
          head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        },
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
      photos: {
        head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
      },
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
        photos: {
          head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        },
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
        photos: {
          head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        },
        body: { skip_check_in: true },
      }),
    ).rejects.toThrow('database unavailable');

    expect(photoStorage.deletePhoto).toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/photo.webp',
    );
    expect(accountMonitoringEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'skin_journal_photo_upload_failed',
        metadata: {
          reason: 'entry_save_failed_after_photo_upload',
          storedPhotoCount: 1,
        },
        user_id: 'user-1',
      }),
    );
    expect(photoStorage.deletePhoto).not.toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/old.webp',
    );
  });

  it('deletes newly stored photos when per-angle metadata save fails', async () => {
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
    entryPhotos.save.mockRejectedValueOnce(new Error('photo metadata failed'));

    await expect(
      service.upsertEntryForResolvedDate({
        userId: 'user-1',
        targetDate: todayInTimeZone('UTC'),
        timeZone: 'UTC',
        photos: {
          head_on: { buffer: Buffer.from('photo'), contentType: 'image/jpeg' },
        },
        body: { skip_check_in: true },
      }),
    ).rejects.toThrow('photo metadata failed');

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

  it('fails account media cleanup when one object delete fails', async () => {
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

    await expect(service.deleteAllMediaForUser('user-1')).rejects.toThrow(
      's3 unavailable',
    );

    expect(photoStorage.deletePhoto).toHaveBeenCalledTimes(1);
    expect(photoStorage.deletePhoto).toHaveBeenNthCalledWith(
      1,
      'skin-journal/user-1/entry-1/photo.webp',
    );
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
                related_inventory_product_id: null,
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
    expect(smartPicksPreparation.scheduleForUser).toHaveBeenCalledWith(
      'user-1',
    );
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

  it('waits for the user selected insight digest day and local time after the first generation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-18T08:59:00.000Z'));
    try {
      const entriesForInsights = Array.from({ length: 8 }, (_, index) =>
        entry({
          id: `entry-${index}`,
          entry_date: `2026-05-${String(index + 1).padStart(2, '0')}`,
          updated_at: new Date(
            `2026-05-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
          ),
        }),
      ).reverse();
      entries.find.mockResolvedValue(entriesForInsights);
      entries.count.mockResolvedValue(entriesForInsights.length);
      users.findOne.mockResolvedValue({ id: 'user-1', time_zone: 'UTC' });
      notifications.getPreferences.mockResolvedValue({
        ai_polished_insights_enabled: true,
        insight_cadence: 'weekly',
        insight_digest_day: 1,
        insight_digest_local_time: '09:00',
      });
      insightStates.findOne.mockResolvedValue({
        user_id: 'user-1',
        dirty_since: new Date('2026-05-02T09:00:00.000Z'),
        dirty_reasons: ['check_in_updated'],
        latest_input_signature: insightInputSignature(entriesForInsights),
        latest_entry_count: entriesForInsights.length,
        last_generated_signature: 'previous-signature',
        last_generated_at: new Date('2026-05-04T09:05:00.000Z'),
        last_generation_trigger: 'scheduled_refresh',
        last_checked_at: null,
      });

      await expect(service.generateInsightsIfNeeded('user-1')).resolves.toBe(
        false,
      );
      expect(insightQueue.enqueueInsightJob).not.toHaveBeenCalled();

      jest.setSystemTime(new Date('2026-05-18T09:05:00.000Z'));
      await expect(service.generateInsightsIfNeeded('user-1')).resolves.toBe(
        true,
      );
      expect(insightQueue.enqueueInsightJob).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses fewer insight cadence to require a longer interval between scheduled generations', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-26T10:00:00.000Z'));
    try {
      const entriesForInsights = Array.from({ length: 8 }, (_, index) =>
        entry({
          id: `entry-${index}`,
          entry_date: `2026-05-${String(index + 1).padStart(2, '0')}`,
          updated_at: new Date(
            `2026-05-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
          ),
        }),
      ).reverse();
      entries.find.mockResolvedValue(entriesForInsights);
      entries.count.mockResolvedValue(entriesForInsights.length);
      users.findOne.mockResolvedValue({ id: 'user-1', time_zone: 'UTC' });
      notifications.getPreferences.mockResolvedValue({
        ai_polished_insights_enabled: true,
        insight_cadence: 'fewer',
        insight_digest_day: 2,
        insight_digest_local_time: '09:00',
      });
      insightStates.findOne.mockResolvedValue({
        user_id: 'user-1',
        dirty_since: new Date('2026-05-10T09:00:00.000Z'),
        dirty_reasons: ['check_in_updated'],
        latest_input_signature: insightInputSignature(entriesForInsights),
        latest_entry_count: entriesForInsights.length,
        last_generated_signature: 'previous-signature',
        last_generated_at: new Date('2026-05-12T09:05:00.000Z'),
        last_generation_trigger: 'scheduled_refresh',
        last_checked_at: null,
      });

      await expect(service.generateInsightsIfNeeded('user-1')).resolves.toBe(
        false,
      );
      expect(insightQueue.enqueueInsightJob).not.toHaveBeenCalled();

      jest.setSystemTime(new Date('2026-06-02T10:00:00.000Z'));
      await expect(service.generateInsightsIfNeeded('user-1')).resolves.toBe(
        true,
      );
      expect(insightQueue.enqueueInsightJob).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
    } finally {
      jest.useRealTimers();
    }
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

  it('keeps AI sourced insight generation enabled without a user quality toggle', async () => {
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
    expect(savedKinds).toEqual(expect.arrayContaining(['ai_summary']));
    expect(insightPolish.polishWithUsage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ aiPolishEnabled: true }),
    );
  });

  it('stores privacy-safe AI Insight cost metadata on the generation run', async () => {
    const entriesForInsights = Array.from({ length: 7 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        entry_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
        photo_object_key: `private/photo-${index}.webp`,
      }),
    ).reverse();
    entries.find.mockResolvedValue(entriesForInsights);
    insights.findOne.mockResolvedValue(null);
    insightPolish.polishWithUsage.mockResolvedValueOnce({
      candidates: [],
      usage: {
        durationMs: 82,
        estimatedCostUsd: 0.000057,
        inputTokens: 180,
        model: 'gpt-5.2',
        outputTokens: 50,
        totalTokens: 230,
      },
    });

    await service.processInsightJob({
      user_id: 'user-1',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: insightInputSignature(entriesForInsights),
      attempt_count: 1,
      max_attempts: 5,
    } as SkinJournalInsightJob);

    const savedRuns = insightRuns.save.mock.calls.map(([run]) => run);
    expect(savedRuns.at(-1)).toEqual(
      expect.objectContaining({
        ai_estimated_cost_usd: 0.000057,
        ai_input_tokens: 180,
        ai_model: 'gpt-5.2',
        ai_output_tokens: 50,
        ai_total_tokens: 230,
        status: 'completed',
      }),
    );
    expect(JSON.stringify(savedRuns)).not.toContain('private/photo-');
    expect(JSON.stringify(savedRuns)).not.toContain('complaint_note');
  });

  it('uses recorded routine applications as evidence for insight generation', async () => {
    const entriesForInsights = Array.from({ length: 10 }, (_, index) =>
      entry({
        id: `entry-${index + 1}`,
        entry_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
        ratings: { redness: 2, breakouts: 2 },
        sun_exposure_today: index < 4 ? 'lots' : 'brief',
      }),
    ).reverse();
    const applicationRows = entriesForInsights.map((item, index) => ({
      id: `application-${item.entry_date}`,
      user_id: 'user-1',
      suggestion_instance_id: `suggestion-${item.entry_date}`,
      slot_id: null,
      target_date: item.entry_date,
      target_time: '08:00',
      daypart: 'morning',
      updated_at: new Date(`${item.entry_date}T09:00:00.000Z`),
      has_been_edited: false,
      items: [
        {
          id: `application-item-${item.entry_date}`,
          step_order: 0,
          suggestion_step_id: `application-step-${item.entry_date}`,
          status:
            index >= entriesForInsights.length - 4 ? 'skipped' : 'applied',
          step_label: 'sun-protection',
          inventory_product_id: 'spf-1',
          substituted_with_product_id: null,
          applied_at:
            index >= entriesForInsights.length - 4
              ? null
              : new Date(`${item.entry_date}T07:30:00.000Z`),
          item_source: 'recommended',
          is_ad_hoc: false,
        },
      ],
    }));
    entries.find.mockResolvedValue(entriesForInsights);
    entries.count.mockResolvedValue(entriesForInsights.length);
    applicationLogs.find.mockResolvedValue(applicationRows);
    insights.findOne.mockResolvedValue(null);

    await service.generateInsightsIfNeeded('user-1');
    const queuedSignature =
      insightQueue.enqueueInsightJob.mock.calls[0]?.[0].inputSignature;

    expect(queuedSignature).toEqual(expect.any(String));
    expect(queuedSignature).not.toEqual(
      insightInputSignature(entriesForInsights),
    );
    await service.processInsightJob({
      user_id: 'user-1',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: queuedSignature,
      attempt_count: 1,
      max_attempts: 5,
    } as SkinJournalInsightJob);

    const savedKinds = insights.save.mock.calls.map(
      ([candidate]) => candidate.kind as string,
    );
    expect(savedKinds).toContain('routine_adherence');
    expect(applicationLogs.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user-1',
        }),
        relations: { items: true },
      }),
    );
  });

  it('keeps insight input signatures stable when routine application evidence loads in different order', async () => {
    const entriesForInsights = Array.from({ length: 10 }, (_, index) =>
      entry({
        id: `entry-${index + 1}`,
        entry_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
        ratings: { redness: 2, breakouts: 2 },
      }),
    ).reverse();
    const applicationRows = (perturbOrder: boolean) => {
      const rows = entriesForInsights.map((item) => {
        const items = [
          {
            id: `spf-item-${item.entry_date}`,
            step_order: 0,
            suggestion_step_id: `spf-step-${item.entry_date}`,
            status: 'applied',
            step_label: 'sun-protection',
            inventory_product_id: 'spf-1',
            substituted_with_product_id: null,
            applied_at: new Date(`${item.entry_date}T07:30:00.000Z`),
            item_source: 'recommended',
            is_ad_hoc: false,
          },
          {
            id: `serum-item-${item.entry_date}`,
            step_order: 1,
            suggestion_step_id: `serum-step-${item.entry_date}`,
            status: 'skipped',
            step_label: 'serum',
            inventory_product_id: 'serum-1',
            substituted_with_product_id: null,
            applied_at: null,
            item_source: 'recommended',
            is_ad_hoc: false,
          },
        ];
        return {
          id: `application-${item.entry_date}`,
          user_id: 'user-1',
          suggestion_instance_id: `suggestion-${item.entry_date}`,
          slot_id: null,
          target_date: item.entry_date,
          target_time: '08:00',
          daypart: 'morning',
          updated_at: new Date(`${item.entry_date}T09:00:00.000Z`),
          has_been_edited: false,
          items: perturbOrder ? [...items].reverse() : items,
        };
      });
      return perturbOrder ? [...rows].reverse() : rows;
    };
    entries.find.mockResolvedValue(entriesForInsights);
    entries.count.mockResolvedValue(entriesForInsights.length);

    applicationLogs.find.mockResolvedValueOnce(applicationRows(false));
    await service.generateInsightsIfNeeded('user-1');
    const firstSignature =
      insightQueue.enqueueInsightJob.mock.calls[0]?.[0].inputSignature;

    insightQueue.enqueueInsightJob.mockClear();
    applicationLogs.find.mockResolvedValueOnce(applicationRows(true));
    await service.generateInsightsIfNeeded('user-1');
    const secondSignature =
      insightQueue.enqueueInsightJob.mock.calls[0]?.[0].inputSignature;

    expect(firstSignature).toEqual(expect.any(String));
    expect(secondSignature).toBe(firstSignature);
  });

  it('passes all saved current photo angles into photo analysis', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-10',
      photo_object_key: 'skin-journal/user-1/entry-current/front.webp',
      analysis_status: 'pending',
    });
    const savedPhotoRows = [
      photoRow({
        id: 'photo-left',
        entry_id: current.id,
        angle: 'left_profile',
        photo_object_key: 'skin-journal/user-1/entry-current/left.webp',
      }),
      photoRow({
        id: 'photo-front',
        entry_id: current.id,
        angle: 'head_on',
        photo_object_key: 'skin-journal/user-1/entry-current/front.webp',
      }),
      photoRow({
        id: 'photo-right',
        entry_id: current.id,
        angle: 'right_profile',
        photo_object_key: 'skin-journal/user-1/entry-current/right.webp',
      }),
    ];
    entries.findOne.mockResolvedValue(current);
    entries.find.mockResolvedValue([]);
    entryPhotos.find.mockResolvedValue(savedPhotoRows);

    await service.runAnalysis(current.id, 'user-1');

    const call = analysis.analyze.mock.calls.at(-1)?.[0] as {
      photos: Array<{ angle: string; object_key: string }>;
    };
    expect(call.photos).toHaveLength(3);
    expect(call.photos).toEqual(
      expect.arrayContaining([
        {
          angle: 'head_on',
          object_key: 'skin-journal/user-1/entry-current/front.webp',
        },
        {
          angle: 'left_profile',
          object_key: 'skin-journal/user-1/entry-current/left.webp',
        },
        {
          angle: 'right_profile',
          object_key: 'skin-journal/user-1/entry-current/right.webp',
        },
      ]),
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
    routineSteps.find.mockResolvedValue([
      {
        inventory_product_id: 'inventory-1',
        step_label: 'treatment',
        optional: false,
        is_specialist_locked: false,
        slot: { user_id: 'user-1', deleted_at: null },
        product: {
          id: 'inventory-1',
          brand: 'Test',
          name: 'Retinol Serum',
          category: 'serum',
          opened_at: new Date('2026-04-08T18:00:00.000Z'),
          expires_at: new Date('2026-10-08T18:00:00.000Z'),
          effective_expires_at: new Date('2026-10-08T18:00:00.000Z'),
          introduction_status: 'week_1',
          introduction_started_at: new Date('2026-04-08T18:00:00.000Z'),
          introduction_status_updated_at: new Date('2026-04-09T18:00:00.000Z'),
          identity: {
            benefits: ['texture support'],
            suitedFor: ['experienced retinoid users'],
            inciIngredients: ['retinol', 'squalane', 'glycerin'],
          },
          guidance: {
            applicationMethod: 'dropper',
            quantity: 'pea-size',
            steps: ['Apply after moisturizer if sensitive'],
            cautions: ['Use only at night'],
            waitMinutes: 10,
          },
          user_fields: {
            preferredTimeOfDay: 'evening',
            personalNotes: 'Can sting if layered too often.',
          },
        },
      },
    ]);
    inventoryProducts.find.mockResolvedValue([
      {
        id: 'inventory-1',
        user_id: 'user-1',
        brand: 'Test',
        name: 'Retinol Serum',
        category: 'serum',
        opened_at: new Date('2026-04-08T18:00:00.000Z'),
        expires_at: new Date('2026-10-08T18:00:00.000Z'),
        effective_expires_at: new Date('2026-10-08T18:00:00.000Z'),
        introduction_status: 'week_1',
        introduction_started_at: new Date('2026-04-08T18:00:00.000Z'),
        introduction_status_updated_at: new Date('2026-04-09T18:00:00.000Z'),
        identity: {
          benefits: ['texture support'],
          suitedFor: ['experienced retinoid users'],
          inciIngredients: ['retinol', 'squalane', 'glycerin'],
        },
        guidance: {
          applicationMethod: 'dropper',
          quantity: 'pea-size',
          steps: ['Apply after moisturizer if sensitive'],
          cautions: ['Use only at night'],
          waitMinutes: 10,
        },
        user_fields: {
          preferredTimeOfDay: 'evening',
          personalNotes: 'Can sting if layered too often.',
        },
      },
      {
        id: 'inventory-2',
        user_id: 'user-1',
        brand: 'Test',
        name: 'Rich Balm',
        category: 'moisturizer',
        opened_at: null,
        expires_at: null,
        effective_expires_at: null,
        introduction_status: 'tolerated',
        introduction_started_at: null,
        introduction_status_updated_at: null,
        identity: {
          benefits: ['barrier support'],
          suitedFor: ['dry skin'],
          inciIngredients: ['petrolatum', 'shea butter'],
        },
        guidance: {
          applicationMethod: null,
          quantity: null,
          steps: [],
          cautions: [],
          waitMinutes: null,
        },
        user_fields: { preferredTimeOfDay: 'either', personalNotes: null },
      },
    ]);
    applicationLogs.find.mockResolvedValue([
      {
        target_date: '2026-04-09',
        target_time: '20:00:00',
        daypart: 'evening',
        applied_at: new Date('2026-04-09T20:00:00.000Z'),
        general_notes: 'Cheeks felt warmer after the evening routine.',
        has_been_edited: true,
        items: [
          {
            status: 'skipped',
            inventory_product_id: 'inventory-1',
            substituted_with_product_id: null,
            product_brand_snapshot: 'Test',
            product_name_snapshot: 'Retinol Serum',
            step_label: 'treatment',
            product: {
              brand: 'Test',
              name: 'Retinol Serum',
              category: 'serum',
            },
            substituted_with_product: null,
            applied_at: null,
            item_source: 'recommended',
            is_ad_hoc: false,
            ad_hoc_brand: null,
            ad_hoc_name: null,
            notes: 'Skipped because it stung last time.',
            substitution_reason: null,
            recommended_snapshot: {
              product_id: 'inventory-1',
              brand: 'Test',
              name: 'Retinol Serum',
              step_label: 'treatment',
            },
            applied_snapshot: null,
          },
        ],
      },
    ]);
    simplifications.findOne.mockResolvedValue({
      id: 'simplification-1',
      user_id: 'user-1',
      simplification_mode: 'barrier_repair',
      recovery_phase: 'stabilize',
      recovery_trigger_source: 'reaction_report',
      recovery_trigger_symptoms: ['burning', 'redness'],
      recovery_trigger_severity: 'moderate',
      recovery_active_overuse: true,
      recovery_review_after: new Date('2026-04-13T08:00:00.000Z'),
      recovery_exit_eligible_at: new Date('2026-04-15T08:00:00.000Z'),
      recovery_return_step: 'not_started',
      restore_strategy: 'phased',
    });

    await service.runAnalysis(current.id, 'user-1');

    expect(routineMemory.getTimeline).toHaveBeenCalledTimes(1);
    expect(routineMemory.getTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', time_zone: 'UTC' }),
      { from: '2026-03-12', to: '2026-04-10' },
      expect.any(Date),
      'UTC',
    );
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
          recent_change_product_id: 'inventory-1',
          recent_change_note: 'retinoid',
          complaint_note: 'Burning feeling near cheeks',
          is_pre_routine: true,
        }),
        routineContext: expect.objectContaining({
          active_recovery: expect.objectContaining({
            active: true,
            simplification_mode: 'barrier_repair',
            recovery_phase: 'stabilize',
            trigger_source: 'reaction_report',
            trigger_symptoms: ['burning', 'redness'],
            trigger_severity: 'moderate',
            active_overuse: true,
            review_after: '2026-04-13T08:00:00.000Z',
            exit_eligible_at: '2026-04-15T08:00:00.000Z',
            return_step: 'not_started',
            restore_strategy: 'phased',
          }),
          routine_memory: expect.objectContaining({
            window: {
              start: '2026-03-12',
              end: '2026-04-10',
              days: 30,
            },
            summary: expect.objectContaining({
              timeline_event_count: 3,
              suspicious_product_count: 1,
              has_possible_links: true,
            }),
            suspicious_products: [
              expect.objectContaining({
                product_id: 'inventory-1',
                name: 'Retinol Serum',
                suspicion_level: 'possible',
                reason_codes: ['reaction_after_first_logged_use'],
                days_from_first_use_to_reaction: 2,
              }),
            ],
            recent_events: expect.arrayContaining([
              expect.objectContaining({
                type: 'first_logged_use',
                product_id: 'inventory-1',
                name: 'Retinol Serum',
                source_type: 'application_log',
              }),
            ]),
          }),
          active_shelf_products: expect.arrayContaining([
            expect.objectContaining({
              product_id: 'inventory-1',
              brand: 'Test',
              name: 'Retinol Serum',
              category: 'serum',
              preferred_time: 'evening',
              opened_at: '2026-04-08T18:00:00.000Z',
              expires_at: '2026-10-08T18:00:00.000Z',
              effective_expires_at: '2026-10-08T18:00:00.000Z',
              introduction_status: 'week_1',
              introduction_started_at: '2026-04-08T18:00:00.000Z',
              introduction_status_updated_at: '2026-04-09T18:00:00.000Z',
              benefit_tags: ['texture support'],
              suited_for_tags: ['experienced retinoid users'],
              ingredient_preview: ['retinol', 'squalane', 'glycerin'],
              application_method: 'dropper',
              quantity: 'pea-size',
              wait_minutes: 10,
              guidance_steps: ['Apply after moisturizer if sensitive'],
              guidance_cautions: ['Use only at night'],
              user_product_note: 'Can sting if layered too often.',
            }),
            expect.objectContaining({
              product_id: 'inventory-2',
              name: 'Rich Balm',
              category: 'moisturizer',
              preferred_time: 'either',
              benefit_tags: ['barrier support'],
              suited_for_tags: ['dry skin'],
            }),
          ]),
          routine_products: expect.arrayContaining([
            expect.objectContaining({
              product_id: 'inventory-1',
              brand: 'Test',
              name: 'Retinol Serum',
              category: 'serum',
              step_label: 'treatment',
              introduction_status: 'week_1',
              guidance_cautions: ['Use only at night'],
            }),
          ]),
          recent_applications: expect.arrayContaining([
            expect.objectContaining({
              target_date: '2026-04-09',
              target_time: '20:00:00',
              daypart: 'evening',
              general_notes: 'Cheeks felt warmer after the evening routine.',
              has_been_edited: true,
              items: expect.arrayContaining([
                expect.objectContaining({
                  status: 'skipped',
                  product_id: 'inventory-1',
                  name: 'Retinol Serum',
                  category: 'serum',
                  applied_at: null,
                  item_source: 'recommended',
                  is_ad_hoc: false,
                  recommended_product_id: 'inventory-1',
                  recommended_name: 'Retinol Serum',
                  applied_product_id: null,
                  applied_name: null,
                  notes: 'Skipped because it stung last time.',
                }),
              ]),
            }),
          ]),
          recent_check_ins: expect.arrayContaining([
            expect.objectContaining({
              entry_date: '2026-04-10',
              sleep_band: '5to7h',
              stress_today: 'high',
              recent_change_product_id: 'inventory-1',
              recent_change_note: 'retinoid',
            }),
          ]),
        }),
      }),
    );
    const call = analysis.analyze.mock.calls.at(-1)?.[0] as {
      skinContext?: Record<string, unknown> | null;
      routineContext?: Record<string, unknown> | null;
    };
    expect(call.skinContext).not.toHaveProperty('ethnicity');
    expect(call.skinContext).not.toHaveProperty('country_code');
    expect(call.skinContext).not.toHaveProperty('city');
    expect(JSON.stringify(call.routineContext)).not.toContain('imageUrl');
    expect(JSON.stringify(call.routineContext)).not.toContain('sourceId');
    expect(photoInterpretation.interpret).toHaveBeenCalledWith(
      expect.objectContaining({ model_version: 'test-model' }),
      expect.any(Date),
      expect.objectContaining({
        skinContext: expect.objectContaining({
          skin_tone: 'medium_deep',
          fitzpatrick_phototype: 'V',
        }),
        recentChange: current.recent_change,
        routineContext: expect.objectContaining({
          routine_memory: expect.objectContaining({
            summary: expect.objectContaining({
              has_possible_links: true,
            }),
            suspicious_products: [
              expect.objectContaining({
                product_id: 'inventory-1',
                reason_codes: ['reaction_after_first_logged_use'],
              }),
            ],
          }),
          active_recovery: expect.objectContaining({
            recovery_phase: 'stabilize',
            trigger_source: 'reaction_report',
            active_overuse: true,
          }),
          routine_products: [
            expect.objectContaining({
              product_id: 'inventory-1',
              name: 'Retinol Serum',
              step_label: 'treatment',
              introduction_status: 'week_1',
            }),
          ],
          recent_applications: [
            expect.objectContaining({
              target_date: '2026-04-09',
              items: [
                expect.objectContaining({
                  status: 'skipped',
                  name: 'Retinol Serum',
                }),
              ],
            }),
          ],
          recent_check_ins: expect.arrayContaining([
            expect.objectContaining({
              entry_date: '2026-04-10',
              ratings: { redness: 4, irritation: 3, sensitivity: 4 },
              stress_today: 'high',
              recent_change_note: 'retinoid',
              complaint_note: 'Burning feeling near cheeks',
            }),
          ]),
        }),
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

  it('skips reaction days as normal analysis references and stores the chosen reference metadata', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-12',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'pending',
    });
    const reactionPrior = entry({
      id: 'entry-reaction',
      entry_date: '2026-04-11',
      photo_object_key: 'skin-journal/user-1/entry-reaction/photo.webp',
      analysis_status: 'completed',
      has_reaction_signal: true,
      analysis_observations: {
        schema_version: '1.2',
        model_version: 'test-model',
        image_quality: {
          face_detected: true,
          lighting_quality: 'good',
          framing_quality: 'good',
          blur_detected: false,
          issues: [],
          needs_retake: false,
          quality_score: 0.92,
          excluded_from_trends_reason: null,
        },
        per_angle_quality: [],
        detected_concerns: [],
        reaction_signals: {
          reaction_detected: true,
          reaction_severity: 'moderate',
          indicators: ['redness_spike'],
          confidence: 0.72,
        },
        barrier_signs: { barrier_compromise: false, indicators: [] },
        overall_assessment: 'Reaction day.',
        overall_change_from_previous: 'worsened',
        user_visible_message: 'Reaction day.',
        safety_flags: {
          urgent_review_recommended: false,
          doctor_follow_up_recommended: false,
          reasons: [],
        },
        should_flag_for_doctor: false,
      },
    });
    const cleanPrior = entry({
      id: 'entry-clean',
      entry_date: '2026-04-09',
      photo_object_key: 'skin-journal/user-1/entry-clean/photo.webp',
      analysis_status: 'completed',
      has_reaction_signal: false,
      analysis_observations: {
        schema_version: '1.2',
        model_version: 'test-model',
        image_quality: {
          face_detected: true,
          lighting_quality: 'good',
          framing_quality: 'good',
          blur_detected: false,
          issues: [],
          needs_retake: false,
          quality_score: 0.88,
          excluded_from_trends_reason: null,
        },
        per_angle_quality: [],
        detected_concerns: [],
        reaction_signals: {
          reaction_detected: false,
          reaction_severity: 'none',
          indicators: [],
          confidence: 0.1,
        },
        barrier_signs: { barrier_compromise: false, indicators: [] },
        overall_assessment: 'Clean reference.',
        overall_change_from_previous: 'stable',
        user_visible_message: 'Clean reference.',
        safety_flags: {
          urgent_review_recommended: false,
          doctor_follow_up_recommended: false,
          reasons: [],
        },
        should_flag_for_doctor: false,
      },
    });
    entries.findOne.mockResolvedValue(current);
    entries.find
      .mockResolvedValueOnce([reactionPrior, cleanPrior])
      .mockResolvedValue([cleanPrior, reactionPrior, current]);

    await service.runAnalysis(current.id, 'user-1');

    expect(analysis.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        priorPhotoObjectKey: 'skin-journal/user-1/entry-clean/photo.webp',
        priorAnalysis: cleanPrior.analysis_observations,
      }),
    );
    expect(entries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'entry-current',
        analysis_observations: expect.objectContaining({
          comparison_reference: expect.objectContaining({
            entry_id: 'entry-clean',
            entry_date: '2026-04-09',
            quality: expect.objectContaining({
              status: 'good_reference',
            }),
          }),
        }),
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
    expect(smartPicksPreparation.scheduleForUser).toHaveBeenCalledWith(
      'user-1',
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

  it('records retryable analysis failure codes while rescheduling jobs', async () => {
    const current = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'queued',
    });
    entries.findOne.mockResolvedValue(current);
    analysis.analyze.mockRejectedValueOnce(
      Object.assign(new Error('Provider timed out'), {
        code: AnalysisFailureCodeValue.ProviderTimeout,
        retryable: true,
      }),
    );

    await service.processAnalysisJob({
      id: 'analysis-job-retry-code',
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
        analysis_error: 'Provider timed out',
        analysis_error_code: AnalysisFailureCodeValue.ProviderTimeout,
      }),
    );
    expect(analysisQueue.rescheduleJob).toHaveBeenCalled();
    expect(analysisQueue.failJob).not.toHaveBeenCalled();
  });

  it('does not retry non-recoverable local photo analysis failures', async () => {
    const current = entry({
      id: 'entry-current',
      photo_object_key: 'skin-journal/user-1/entry-current/photo.webp',
      analysis_status: 'queued',
    });
    entries.findOne.mockResolvedValue(current);
    analysis.analyze.mockRejectedValueOnce(
      Object.assign(new Error('Photo failed local quality checks'), {
        code: AnalysisFailureCodeValue.PhotoPreflightRejected,
        retryable: false,
      }),
    );

    await service.processAnalysisJob({
      id: 'analysis-job-non-retryable',
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
        analysis_status: 'failed',
        analysis_error: 'Photo failed local quality checks',
        analysis_error_code: AnalysisFailureCodeValue.PhotoPreflightRejected,
      }),
    );
    expect(analysisQueue.rescheduleJob).not.toHaveBeenCalled();
    expect(analysisQueue.failJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'analysis-job-non-retryable' }),
      'Photo failed local quality checks',
    );
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
      expect.objectContaining({
        kind: 'analysis_failed',
        dedupeKey: expectNotificationDedupeKey('analysis_failed'),
      }),
    );
  });

  it('deduplicates reaction and simplification notifications by their source event', async () => {
    const current = entry({
      id: 'entry-reaction',
      entry_date: '2026-04-10',
      photo_object_key: 'skin-journal/user-1/entry-reaction/photo.webp',
      analysis_status: 'pending',
    });
    entries.findOne.mockResolvedValue(current);
    entries.find.mockResolvedValue([current]);
    events.findOne.mockResolvedValue(null);
    analysis.analyze.mockResolvedValueOnce(
      analysisRunResult(
        analyzedObservations({
          reaction_signals: {
            reaction_detected: true,
            reaction_severity: 'moderate',
            indicators: ['redness_spike'],
            confidence: 0.8,
          },
          barrier_signs: { barrier_compromise: true, indicators: [] },
          should_flag_for_doctor: false,
        }),
      ),
    );

    await service.runAnalysis('entry-reaction', 'user-1');

    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'reaction_detected',
        dedupeKey: expectNotificationDedupeKey('reaction_detected'),
      }),
    );
    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'simplification_started',
        dedupeKey: expectNotificationDedupeKey('simplification_started'),
      }),
    );
  });

  it('starts Recovery Mode with photo-analysis metadata for moderate reaction signals', async () => {
    const current = entry({
      id: 'entry-reaction',
      entry_date: '2026-04-10',
      photo_object_key: 'skin-journal/user-1/entry-reaction/photo.webp',
      analysis_status: 'pending',
    });
    entries.findOne.mockResolvedValue(current);
    entries.find.mockResolvedValue([current]);
    events.findOne.mockResolvedValue(null);
    analysis.analyze.mockResolvedValueOnce(
      analysisRunResult(
        analyzedObservations({
          reaction_signals: {
            reaction_detected: true,
            reaction_severity: 'moderate',
            indicators: ['redness_spike'],
            confidence: 0.82,
          },
          barrier_signs: { barrier_compromise: true, indicators: [] },
          should_flag_for_doctor: false,
        }),
      ),
    );

    await service.runAnalysis('entry-reaction', 'user-1');

    expect(simplifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recovery_trigger_source: 'photo_analysis',
        recovery_trigger_severity: 'moderate',
        recovery_return_step: 'not_started',
        restore_strategy: 'phased',
      }),
    );
  });

  it('deduplicates insight-ready notifications by the created insight batch', async () => {
    const current = entry({
      id: 'entry-current',
      entry_date: '2026-04-10',
      analysis_status: 'completed',
      analysis_summary: 'Looks stable.',
    });
    entries.find.mockResolvedValue([current]);
    insights.findOne.mockResolvedValue(null);
    insights.save.mockImplementation(async (data) => ({
      id: 'insight-created',
      generated_at: new Date('2026-04-10T09:00:00.000Z'),
      seen_at: null,
      dismissed_at: null,
      ...data,
    }));

    await service.processInsightJob({
      user_id: 'user-1',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: insightInputSignature([current]),
      attempt_count: 1,
      max_attempts: 5,
    } as SkinJournalInsightJob);

    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'insight_ready',
        dedupeKey: expectNotificationDedupeKey('insight_ready'),
      }),
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
        analysis_input_image_count: 2,
        analysis_observations: {
          schema_version: '1.2',
          model_version: 'test-model',
          image_quality: {
            face_detected: true,
            lighting_quality: 'good',
            framing_quality: 'good',
            blur_detected: false,
            issues: [],
            quality_score: 0.9,
            needs_retake: false,
            excluded_from_trends_reason: null,
          },
          per_angle_quality: [
            {
              angle: 'head_on',
              face_detected: true,
              lighting_quality: 'good',
              framing_quality: 'good',
              blur_detected: false,
              issues: [],
              quality_score: 0.9,
              needs_retake: false,
              used_for_analysis: true,
            },
            {
              angle: 'left_profile',
              face_detected: true,
              lighting_quality: 'poor',
              framing_quality: 'fair',
              blur_detected: false,
              issues: ['too_dark'],
              quality_score: 0.4,
              needs_retake: true,
              used_for_analysis: false,
            },
          ],
          detected_concerns: [
            {
              concern: 'redness_inflammation',
              severity: 'mild',
              locations: ['left_cheek'],
              confidence: 0.6,
              change_from_previous: 'stable',
              change_confidence: 0.5,
            },
          ],
          reaction_signals: {
            reaction_detected: false,
            reaction_severity: 'none',
            indicators: [],
            confidence: 0.2,
          },
          barrier_signs: { barrier_compromise: false, indicators: [] },
          overall_assessment: 'Looks stable.',
          overall_change_from_previous: 'stable',
          user_visible_message: 'Looks stable.',
          safety_flags: {
            urgent_review_recommended: false,
            doctor_follow_up_recommended: false,
            reasons: [],
          },
          should_flag_for_doctor: false,
        },
      }),
      entry({
        id: 'entry-failed',
        analysis_status: 'failed',
        analysis_started_at: new Date(),
        analysis_duration_ms: 300,
        analysis_total_tokens: 500,
        analysis_estimated_cost_usd: 0.02,
        analysis_error_code: AnalysisFailureCodeValue.ProviderTimeout,
      }),
      entry({
        id: 'entry-local-non-face',
        analysis_status: 'failed',
        analysis_started_at: new Date(),
        analysis_error:
          'Photo failed local quality checks: no_local_face_detected',
        analysis_error_code: AnalysisFailureCodeValue.PhotoPreflightRejected,
      }),
    ]);

    const result = await service.getAnalysisQueueOperations(
      'ops-token-123456789012345678901234',
    );

    expect(result.queue.queued_count).toBe(2);
    expect(result.analysis.average_duration_ms).toBe(200);
    expect(result.analysis.total_tokens).toBe(1500);
    expect(result.analysis.average_input_image_count).toBe(2);
    expect(result.analysis.multi_angle_rate).toBeCloseTo(1 / 3, 5);
    expect(result.analysis.failure_codes).toEqual({
      [AnalysisFailureCodeValue.ProviderTimeout]: 1,
      [AnalysisFailureCodeValue.PhotoPreflightRejected]: 1,
    });
    expect(result.analysis.photo_preflight).toEqual({
      rejected_count: 1,
      issue_counts: {
        no_local_face_detected: 1,
      },
      local_face_rejection_rate: expect.any(Number),
      ai_no_face_rate: 0,
      ml_detector_review_recommended: true,
      ml_detector_review_reasons: ['local_face_rejection_rate_high'],
    });
    expect(
      result.analysis.photo_preflight.local_face_rejection_rate,
    ).toBeCloseTo(1 / 3, 5);
    expect(
      result.analysis.per_angle_quality.head_on.average_quality_score,
    ).toBe(0.9);
    expect(
      result.analysis.per_angle_quality.left_profile.needs_retake_rate,
    ).toBe(1);
    expect(result.analysis.concern_counts).toEqual({
      redness_inflammation: 1,
    });
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

  it('records insight interactions and reports usefulness metrics without user payloads', async () => {
    const generatedAt = new Date();
    const trendInsight = {
      id: 'insight-trend',
      user_id: 'user-1',
      kind: 'trend',
      generated_at: generatedAt,
      seen_at: null,
      dismissed_at: null,
    } as SkinJournalInsight;
    const routineInsight = {
      id: 'insight-routine',
      user_id: 'user-2',
      kind: 'routine_adherence',
      generated_at: generatedAt,
      seen_at: generatedAt,
      dismissed_at: generatedAt,
    } as SkinJournalInsight;
    insights.findOne.mockResolvedValue(trendInsight);

    await service.markInsightSeen('user-1', trendInsight.id);
    await service.recordInsightAction('user-1', trendInsight.id, {
      action_kind: 'open_compare',
    });
    await service.dismissInsight('user-1', trendInsight.id);

    expect(insightInteractions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        insight_id: trendInsight.id,
        interaction_type: 'seen',
        action_kind: null,
      }),
    );
    expect(insightInteractions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        insight_id: trendInsight.id,
        interaction_type: 'action_clicked',
        action_kind: 'open_compare',
      }),
    );
    expect(insightInteractions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        insight_id: trendInsight.id,
        interaction_type: 'dismissed',
        action_kind: null,
      }),
    );

    insights.find.mockResolvedValue([trendInsight, routineInsight]);
    insightInteractions.find.mockResolvedValue([
      {
        insight_id: trendInsight.id,
        interaction_type: 'seen',
        action_kind: null,
        created_at: generatedAt,
      },
      {
        insight_id: trendInsight.id,
        interaction_type: 'action_clicked',
        action_kind: 'open_compare',
        created_at: generatedAt,
      },
      {
        insight_id: trendInsight.id,
        interaction_type: 'dismissed',
        action_kind: null,
        created_at: generatedAt,
      },
      {
        insight_id: routineInsight.id,
        interaction_type: 'dismissed',
        action_kind: null,
        created_at: generatedAt,
      },
    ]);

    const result = await service.getInsightOperations(
      'ops-token-123456789012345678901234',
    );

    expect(result.usefulness.generated_count).toBe(2);
    expect(result.usefulness.action_click_rate).toBeCloseTo(0.5, 5);
    expect(result.usefulness.dismissed_rate).toBe(1);
    expect(result.usefulness.by_kind.trend).toEqual(
      expect.objectContaining({
        generated_count: 1,
        action_click_count: 1,
        dismissed_count: 1,
      }),
    );
    expect(result.usefulness.evaluation_case_hints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          insight_kind: 'trend',
          reason: 'high_dismissal_rate',
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('user-1');
    expect(JSON.stringify(result)).not.toContain('insight-trend');
  });

  it('rejects operations metrics without the private operations token', async () => {
    await expect(
      service.getAnalysisQueueOperations('wrong-token'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getInsightOperations('wrong-token'),
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

  it('adds photo-analysis concern, reaction, and barrier deltas to compare results', async () => {
    entries.findOne
      .mockResolvedValueOnce(
        entry({
          id: 'from-entry',
          entry_date: '2026-04-10',
          photo_object_key: 'skin-journal/user-1/from-entry/photo.webp',
          analysis_status: 'completed',
          analysis_observations: {
            schema_version: '1.2',
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
            per_angle_quality: [],
            detected_concerns: [
              {
                concern: 'acne',
                severity: 'mild',
                locations: ['chin'],
                confidence: 0.66,
                change_from_previous: 'stable',
                change_confidence: 0.62,
              },
            ],
            reaction_signals: {
              reaction_detected: false,
              reaction_severity: 'none',
              indicators: [],
              confidence: 0.1,
            },
            barrier_signs: {
              barrier_compromise: false,
              indicators: [],
            },
            overall_assessment: 'Earlier photo.',
            overall_change_from_previous: 'stable',
            user_visible_message: 'Earlier photo.',
            safety_flags: {
              urgent_review_recommended: false,
              doctor_follow_up_recommended: false,
              reasons: [],
            },
            should_flag_for_doctor: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        entry({
          id: 'to-entry',
          entry_date: '2026-04-18',
          photo_object_key: 'skin-journal/user-1/to-entry/photo.webp',
          analysis_status: 'completed',
          analysis_observations: {
            schema_version: '1.2',
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
            per_angle_quality: [],
            detected_concerns: [
              {
                concern: 'acne',
                severity: 'moderate',
                locations: ['chin'],
                confidence: 0.76,
                change_from_previous: 'worsened',
                change_confidence: 0.7,
              },
            ],
            reaction_signals: {
              reaction_detected: true,
              reaction_severity: 'moderate',
              indicators: ['redness_spike'],
              confidence: 0.75,
            },
            barrier_signs: {
              barrier_compromise: true,
              indicators: ['flaking'],
            },
            overall_assessment: 'Later photo.',
            overall_change_from_previous: 'worsened',
            user_visible_message: 'Later photo.',
            safety_flags: {
              urgent_review_recommended: false,
              doctor_follow_up_recommended: false,
              reasons: [],
            },
            should_flag_for_doctor: false,
          },
        }),
      );

    const result = await service.getCompare(
      'user-1',
      '2026-04-10',
      '2026-04-18',
    );

    expect(result.delta.bullets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'photo_concern_worsened',
          tone: 'warn',
          analysis_concern: 'acne',
          from_severity: 'mild',
          to_severity: 'moderate',
        }),
        expect.objectContaining({
          code: 'reaction_signal_increased',
          tone: 'warn',
          from_severity: 'none',
          to_severity: 'moderate',
        }),
        expect.objectContaining({
          code: 'barrier_signal_worsened',
          tone: 'warn',
        }),
      ]),
    );
  });

  it('explains when photo compare is limited by image quality', async () => {
    entries.findOne
      .mockResolvedValueOnce(
        entry({
          id: 'from-entry',
          entry_date: '2026-04-10',
          photo_object_key: 'skin-journal/user-1/from-entry/photo.webp',
          analysis_status: 'completed',
          analysis_observations: {
            schema_version: '1.2',
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
            per_angle_quality: [],
            detected_concerns: [],
            reaction_signals: {
              reaction_detected: false,
              reaction_severity: 'none',
              indicators: [],
              confidence: 0.1,
            },
            barrier_signs: { barrier_compromise: false, indicators: [] },
            overall_assessment: 'Too dark.',
            overall_change_from_previous: 'not_comparable',
            user_visible_message: 'Too dark.',
            safety_flags: {
              urgent_review_recommended: false,
              doctor_follow_up_recommended: false,
              reasons: [],
            },
            should_flag_for_doctor: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        entry({
          id: 'to-entry',
          entry_date: '2026-04-18',
          photo_object_key: 'skin-journal/user-1/to-entry/photo.webp',
          analysis_status: 'completed',
          analysis_observations: null,
        }),
      );

    const result = await service.getCompare(
      'user-1',
      '2026-04-10',
      '2026-04-18',
    );

    expect(result.delta.bullets).toEqual([
      expect.objectContaining({
        code: 'not_comparable',
        tone: 'warn',
        reason: 'poor_lighting',
      }),
    ]);
  });
});
