import { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { User } from '../../users/entities/user.entity';
import { UserDataAccessLogService } from '../../users/user-data-access-log.service';
import { UserConsentType } from '../../users/user-consent.constants';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionStep } from '../entities/suggestion-step.entity';
import { SuggestionAiUsageGuard } from './suggestion-ai-usage-guard.service';
import { SuggestionContextSummary } from '../suggestion-context.types';
import { SuggestionAiGenerator } from './suggestion-ai-generator';
import { SuggestionConsentService } from './suggestion-consent.service';
import { SuggestionContextBuilder } from './suggestion-context-builder.service';
import { SuggestionGenerationService } from './suggestion-generation.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { SuggestionTodayActionService } from './suggestion-today-action.service';

describe('SuggestionGenerationService', () => {
  const aiGenerator = {
    generate: jest.fn(),
  } as unknown as jest.Mocked<SuggestionAiGenerator>;
  const usageGuard = {
    evaluate: jest.fn(),
  } as unknown as jest.Mocked<SuggestionAiUsageGuard>;
  const consentService = {
    evaluate: jest.fn(),
  } as unknown as jest.Mocked<SuggestionConsentService>;
  const contextBuilder = {
    build: jest.fn(),
  } as unknown as jest.Mocked<SuggestionContextBuilder>;
  const todayActionService = {
    shouldIgnoreReactionContext: jest.fn(),
  } as unknown as jest.Mocked<SuggestionTodayActionService>;
  const notifications = {
    dispatch: jest.fn(),
  } as unknown as jest.Mocked<NotificationsService>;
  const dataAccessLog = {
    recordDataAccess: jest.fn(),
  } as unknown as jest.Mocked<UserDataAccessLogService>;
  const observability = {
    record: jest.fn(),
  } as unknown as jest.Mocked<SuggestionObservabilityService>;
  const suggestionRepo = repo<SuggestionInstance>();
  const suggestionStepRepo = repo<SuggestionStep>();
  const jobRepo = repo<SuggestionGenerationJob>();
  const slotRepo = repo<ScheduleSlot>();
  const routineStepRepo = repo<RoutineStep>();
  const inventoryRepo = repo<InventoryProduct>();
  const journalRepo = repo<SkinJournalEntry>();
  const skinProfileRepo = repo<SkinProfile>();
  const applicationLogRepo = repo<ApplicationLog>();
  const userRepo = repo<User>();
  const preferenceRepo = repo<UserNotificationPreference>();
  let txSuggestionRepo: jest.Mocked<Repository<SuggestionInstance>>;
  let txStepRepo: jest.Mocked<Repository<SuggestionStep>>;
  let dataSource: DataSource;
  let service: SuggestionGenerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    txSuggestionRepo = repo<SuggestionInstance>();
    txStepRepo = repo<SuggestionStep>();
    dataSource = dataSourceWithRepos(txSuggestionRepo, txStepRepo);
    service = new SuggestionGenerationService(
      dataSource,
      aiGenerator,
      usageGuard,
      consentService,
      contextBuilder,
      todayActionService,
      notifications,
      observability,
      dataAccessLog,
      suggestionRepo,
      suggestionStepRepo,
      jobRepo,
      slotRepo,
      routineStepRepo,
      inventoryRepo,
      journalRepo,
      skinProfileRepo,
      applicationLogRepo,
      userRepo,
      preferenceRepo,
    );
    consentService.evaluate.mockResolvedValue({
      aiPersonalizationAllowed: true,
      canReadSensitiveContext: true,
      blockedReason: null,
      activeSensitiveConsentTypes: [
        UserConsentType.HealthContextProcessing,
        UserConsentType.SkinProgressProcessing,
      ],
    });
    usageGuard.evaluate.mockResolvedValue({
      allowed: true,
      blockedReason: null,
      generationCountToday: 0,
      regenerationCountToday: 0,
      estimatedCostTodayUsd: 0,
    });
    todayActionService.shouldIgnoreReactionContext.mockResolvedValue(false);
  });

  it('builds minimized context, persists a ready suggestion, and dispatches a deduped notification', async () => {
    slotRepo.findOne.mockResolvedValue(slot());
    userRepo.findOne.mockResolvedValue(user());
    skinProfileRepo.findOne.mockResolvedValue(skinProfile());
    inventoryRepo.find
      .mockResolvedValueOnce([product()])
      .mockResolvedValueOnce([{ id: 'finished-1' } as InventoryProduct]);
    journalRepo.find.mockResolvedValue([journal()]);
    applicationLogRepo.find.mockResolvedValue([applicationLog()]);
    preferenceRepo.findOne.mockResolvedValue({
      suggestion_lead_time_minutes: 90,
    } as UserNotificationPreference);
    contextBuilder.build.mockResolvedValue(contextSummary());
    aiGenerator.generate.mockResolvedValue(generationOutput());
    txSuggestionRepo.findOne.mockResolvedValue(null);
    txSuggestionRepo.createQueryBuilder.mockReturnValue(updateBuilder());
    txSuggestionRepo.create.mockImplementation(
      (value) => value as SuggestionInstance,
    );
    txSuggestionRepo.save.mockImplementation(
      async (value) =>
        ({
          ...(value as SuggestionInstance),
          id: (value as SuggestionInstance).id ?? 'suggestion-1',
          created_at: (value as SuggestionInstance).created_at ?? new Date(),
          updated_at: (value as SuggestionInstance).updated_at ?? new Date(),
        }) as SuggestionInstance,
    );
    txStepRepo.create.mockImplementation((value) => value as SuggestionStep);
    mockSaveArray(txStepRepo).mockResolvedValue([]);

    await service.generateForJob(job());

    expect(dataAccessLog.recordDataAccess).toHaveBeenCalledWith(
      'user-1',
      [
        UserConsentType.HealthContextProcessing,
        UserConsentType.SkinProgressProcessing,
      ],
      'recommendation_analysis',
      'system',
    );
    expect(contextBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        targetDate: '2026-05-04',
        targetTime: '08:00',
        shelfActiveProducts: [product()],
      }),
    );
    expect(aiGenerator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        slotId: 'slot-1',
        shelfFinishedProductIds: ['finished-1'],
        contextSummary: contextSummary(),
        aiPersonalizationAllowed: true,
      }),
    );
    expect(txSuggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        generation_status: 'ready',
        ai_model: 'gpt-test',
        visible_at: new Date('2026-05-04T06:30:00.000Z'),
        generation_context: contextSummary(),
      }),
    );
    expect(txStepRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({
        suggestion_instance_id: 'suggestion-1',
        inventory_product_id: 'product-1',
      }),
    ]);
    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        kind: 'suggestion_ready',
        dedupeKey: 'suggestion_ready:2026-05-04:slot-1',
      }),
    );
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'generation_completed',
        userId: 'user-1',
      }),
    );
  });

  it('degrades without explicit AI suggestion consent and avoids sensitive context reads', async () => {
    consentService.evaluate.mockResolvedValue({
      aiPersonalizationAllowed: false,
      canReadSensitiveContext: false,
      blockedReason: 'ai_suggestion_processing_consent_missing',
      activeSensitiveConsentTypes: [],
    });
    slotRepo.findOne.mockResolvedValue(slot());
    userRepo.findOne.mockResolvedValue(user());
    inventoryRepo.find
      .mockResolvedValueOnce([product()])
      .mockResolvedValueOnce([]);
    preferenceRepo.findOne.mockResolvedValue(null);
    contextBuilder.build.mockResolvedValue(contextSummary());
    aiGenerator.generate.mockResolvedValue(generationOutput());
    txSuggestionRepo.findOne.mockResolvedValue(null);
    txSuggestionRepo.createQueryBuilder.mockReturnValue(updateBuilder());
    txSuggestionRepo.create.mockImplementation(
      (value) => value as SuggestionInstance,
    );
    txSuggestionRepo.save.mockImplementation(
      async (value) =>
        ({
          ...(value as SuggestionInstance),
          id: 'suggestion-1',
          created_at: new Date(),
          updated_at: new Date(),
        }) as SuggestionInstance,
    );
    txStepRepo.create.mockImplementation((value) => value as SuggestionStep);
    mockSaveArray(txStepRepo).mockResolvedValue([]);

    await service.generateForJob(job());

    expect(usageGuard.evaluate).not.toHaveBeenCalled();
    expect(skinProfileRepo.findOne).not.toHaveBeenCalled();
    expect(journalRepo.find).not.toHaveBeenCalled();
    expect(applicationLogRepo.find).not.toHaveBeenCalled();
    expect(dataAccessLog.recordDataAccess).not.toHaveBeenCalled();
    expect(contextBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        skinProfile: null,
        recentJournalEntries: [],
        recentApplications: [],
        aiPersonalizationAllowed: false,
        aiPersonalizationBlockedReason:
          'ai_suggestion_processing_consent_missing',
      }),
    );
    expect(aiGenerator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPersonalizationAllowed: false,
        aiPersonalizationBlockedReason:
          'ai_suggestion_processing_consent_missing',
      }),
    );
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'consent_degraded',
        severity: 'warning',
      }),
    );
  });

  it('does not crash when the slot or user no longer exists', async () => {
    slotRepo.findOne.mockResolvedValue(null);
    await expect(service.generateForJob(job())).resolves.toBeUndefined();
    expect(userRepo.findOne).not.toHaveBeenCalled();

    slotRepo.findOne.mockResolvedValue(slot());
    userRepo.findOne.mockResolvedValue(null);
    await expect(service.generateForJob(job())).resolves.toBeUndefined();
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    create: jest.fn((value) => value),
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function dataSourceWithRepos(
  suggestionRepo: Repository<SuggestionInstance>,
  stepRepo: Repository<SuggestionStep>,
): DataSource {
  const manager = {
    getRepository: (entity: unknown): Repository<ObjectLiteral> => {
      if (entity === SuggestionInstance) {
        return suggestionRepo;
      }
      if (entity === SuggestionStep) {
        return stepRepo;
      }
      throw new Error('Unexpected repository token.');
    },
  };
  return {
    transaction: jest.fn(
      (callback: (txManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    ),
  } as unknown as DataSource;
}

function updateBuilder() {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  } as never;
}

function mockSaveArray<T extends ObjectLiteral>(
  repository: Repository<T>,
): jest.Mock<Promise<T[]>, [T[]]> {
  return repository.save as unknown as jest.Mock<Promise<T[]>, [T[]]>;
}

function job(): SuggestionGenerationJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    slot_id: 'slot-1',
    target_date: '2026-05-04',
    target_time: '08:00',
    visible_at: new Date('2026-05-04T06:30:00.000Z'),
    attempt_count: 1,
  } as SuggestionGenerationJob;
}

function user(): User {
  return { id: 'user-1', time_zone: 'UTC' } as User;
}

function slot(): ScheduleSlot {
  return {
    id: 'slot-1',
    user_id: 'user-1',
    slot_time: '08:00',
    mode: 'ai',
    steps: [
      {
        id: 'routine-step-1',
        step_order: 0,
        step_label: ProductCategory.Serum,
        inventory_product_id: 'product-1',
        is_specialist_locked: false,
        product: product(),
      },
    ],
  } as unknown as ScheduleSlot;
}

function product(): InventoryProduct {
  return {
    id: 'product-1',
    user_id: 'user-1',
    brand: 'Ava Lab',
    name: 'Barrier Serum',
    category: ProductCategory.Serum,
    status: ShelfStatus.Active,
    guidance: {
      applicationMethod: 'fingertips',
      quantity: 'pea-size',
      steps: [],
      cautions: [],
      waitMinutes: 2,
    },
  } as unknown as InventoryProduct;
}

function skinProfile(): SkinProfile {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    primary_goal: 'barrier support',
  } as SkinProfile;
}

function journal(): SkinJournalEntry {
  return {
    id: 'journal-1',
    user_id: 'user-1',
    entry_date: '2026-05-03',
  } as SkinJournalEntry;
}

function applicationLog(): ApplicationLog {
  return {
    id: 'log-1',
    user_id: 'user-1',
    target_date: '2026-05-03',
    items: [],
  } as unknown as ApplicationLog;
}

function contextSummary(): SuggestionContextSummary {
  return {
    cacheKey: 'ctx',
    builtAt: '2026-05-04T06:00:00.000Z',
    targetDate: '2026-05-04',
    targetTime: '08:00',
    daypart: 'morning',
    skinProfile: {
      primaryGoal: 'barrier support',
      skinType: null,
      sensitivityLevel: null,
      activeConcerns: [],
      pregnancyStatus: null,
    },
    reaction: {
      hasSignal: false,
      severity: null,
      confidence: null,
      indicators: [],
      affectedZones: [],
      concernKeys: [],
      daysSinceLatestSignal: null,
      barrierCompromised: false,
    },
    productScores: [],
    applicationPatterns: {
      days: 0,
      skippedByCategory: {},
      substitutedByCategory: {},
      addedOffShelfCount: 0,
      editedLogCount: 0,
      adherenceByCategory: {},
    },
    safetyConstraints: [],
    governance: {
      safetyPolicyVersion: 'test-policy',
      safetyPolicyReviewedAt: '2026-05-04',
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
    evidenceSources: [],
    skippedCandidates: [],
  };
}

function generationOutput() {
  return {
    mode: 'ai' as const,
    hasReactionSignal: false,
    simplifiedForReaction: false,
    explanation: {
      headline: 'Use the serum',
      body: [],
      perStepReasons: [],
      skipped: [],
      inputs: [],
    },
    gapRecommendations: [],
    safetyFlags: [],
    steps: [
      {
        stepOrder: 0,
        routineStepId: null,
        inventoryProductId: 'product-1',
        productBrand: 'Ava Lab',
        productName: 'Barrier Serum',
        stepLabel: ProductCategory.Serum,
        customLabel: null,
        applicationMethod: 'fingertips',
        quantity: 'pea-size',
        waitAfterMinutes: 2,
        explanation: 'Best fit.',
        provenance: 'ai_added' as const,
        chips: [],
        safetyWarnings: [],
      },
    ],
    metadata: {
      model: 'gpt-test',
      promptVersion: 'prompt-v1',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      estimatedCostUsd: 0.0001,
      durationMs: 123,
    },
  };
}
