import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { DataSource, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { CataloguePhotoStorageService } from '../../catalogue/catalogue-photo-storage.service';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionAiUsageGuard } from './suggestion-ai-usage-guard.service';
import { SuggestionConsentService } from './suggestion-consent.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { RoutineBreakService } from './routine-break.service';
import { SuggestionOnDemandService } from './suggestion-on-demand.service';

describe('SuggestionOnDemandService', () => {
  const suggestionRepo = repo<SuggestionInstance>();
  const inventoryRepo = repo<InventoryProduct>();
  const routineBreakService = {
    isRoutineBreakActive: jest.fn(),
  } as unknown as jest.Mocked<RoutineBreakService>;
  const usageGuard = {
    evaluate: jest.fn(),
  } as unknown as jest.Mocked<SuggestionAiUsageGuard>;
  const consentService = {
    evaluate: jest.fn(),
  } as unknown as jest.Mocked<SuggestionConsentService>;
  const observability = {
    record: jest.fn(),
  } as unknown as jest.Mocked<SuggestionObservabilityService>;
  const cataloguePhotoStorageService = {
    resolvePublicImageUrls: jest.fn((imageUrls: string[]) => imageUrls),
  } as unknown as jest.Mocked<CataloguePhotoStorageService>;

  let txSuggestionRepo: jest.Mocked<Repository<SuggestionInstance>>;
  let txJobRepo: jest.Mocked<Repository<SuggestionGenerationJob>>;
  let service: SuggestionOnDemandService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-06T10:15:00.000Z'));
    txSuggestionRepo = repo<SuggestionInstance>();
    txJobRepo = repo<SuggestionGenerationJob>();
    service = new SuggestionOnDemandService(
      dataSourceWithRepos(txSuggestionRepo, txJobRepo),
      suggestionRepo,
      inventoryRepo,
      routineBreakService,
      usageGuard,
      consentService,
      observability,
      cataloguePhotoStorageService,
    );

    routineBreakService.isRoutineBreakActive.mockResolvedValue(false);
    consentService.evaluate.mockResolvedValue({
      aiPersonalizationAllowed: true,
      canReadSensitiveContext: true,
      blockedReason: null,
      grantedAt: new Date('2026-05-07T09:00:00.000Z'),
      activeSensitiveConsentTypes: [],
    });
    usageGuard.evaluate.mockResolvedValue({
      allowed: true,
      blockedReason: null,
      generationCountToday: 0,
      regenerationCountToday: 0,
      estimatedCostTodayUsd: 0,
    });
    inventoryRepo.count.mockResolvedValue(2);
    suggestionRepo.count.mockResolvedValue(0);
    suggestionRepo.findOne.mockResolvedValue(null);
    txSuggestionRepo.create.mockImplementation(
      (value) => value as SuggestionInstance,
    );
    txSuggestionRepo.save.mockImplementation(
      async (value) =>
        ({
          ...(value as SuggestionInstance),
          id: 'suggestion-on-demand-1',
          created_at: new Date('2026-05-06T10:15:00.000Z'),
          updated_at: new Date('2026-05-06T10:15:00.000Z'),
          steps: [],
        }) as unknown as SuggestionInstance,
    );
    txJobRepo.insert.mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    });
    txJobRepo.findOne.mockResolvedValue({
      id: 'job-on-demand-1',
    } as SuggestionGenerationJob);
    txJobRepo.update.mockResolvedValue({
      affected: 1,
      generatedMaps: [],
      raw: [],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a generating suggestion and queued job without a schedule slot', async () => {
    const result = await service.create(user(), 'Europe/Stockholm', {
      intent: 'post_workout',
      intensity: 'minimal',
      note: 'Back from training and sweaty.',
      requestId: 'quick-20260506',
    });

    expect(txSuggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: null,
        request_source: 'on_demand',
        request_id: 'quick-20260506',
        target_date: '2026-05-06',
        target_time: '12:15',
        daypart: 'noon',
        mode: 'ai',
        generation_status: 'generating',
        request_context: expect.objectContaining({
          intent: 'post_workout',
          intensity: 'minimal',
          note: 'Back from training and sweaty.',
        }),
      }),
    );
    expect(txJobRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: null,
        suggestion_instance_id: 'suggestion-on-demand-1',
        request_source: 'on_demand',
        target_date: '2026-05-06',
        target_time: '12:15',
        status: 'queued',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'suggestion-on-demand-1',
        slotId: null,
        requestSource: 'on_demand',
        generationStatus: 'generating',
      }),
    );
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'on_demand_requested',
        suggestionInstanceId: 'suggestion-on-demand-1',
        metadata: expect.objectContaining({
          intent: 'post_workout',
          requestIdPresent: true,
        }),
      }),
    );
  });

  it('returns an existing suggestion for a repeated request id', async () => {
    suggestionRepo.findOne.mockResolvedValueOnce(existingSuggestion());

    const result = await service.create(user(), null, {
      intent: 'quick_refresh',
      requestId: 'quick-existing',
    });

    expect(result.id).toBe('existing-on-demand');
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'on_demand_duplicate_request',
        suggestionInstanceId: 'existing-on-demand',
      }),
    );
    expect(routineBreakService.isRoutineBreakActive).not.toHaveBeenCalled();
    expect(txSuggestionRepo.save).not.toHaveBeenCalled();
    expect(txJobRepo.insert).not.toHaveBeenCalled();
  });

  it('recovers from a concurrent duplicate request id insert', async () => {
    txSuggestionRepo.save.mockRejectedValueOnce(
      Object.assign(new Error('duplicate request id'), { code: '23505' }),
    );
    suggestionRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingSuggestion({ id: 'existing-after-race' }));

    const result = await service.create(user(), null, {
      intent: 'quick_refresh',
      requestId: 'quick-race',
    });

    expect(result.id).toBe('existing-after-race');
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'on_demand_duplicate_request',
        suggestionInstanceId: 'existing-after-race',
      }),
    );
    expect(txJobRepo.insert).not.toHaveBeenCalled();
  });

  it('requeues a failed on-demand suggestion through the retry path', async () => {
    suggestionRepo.findOne.mockResolvedValueOnce(
      existingSuggestion({
        generation_status: 'failed',
        ai_error: 'timeout',
        ai_retry_count: 3,
      }),
    );
    txSuggestionRepo.save.mockImplementation(
      async (value) =>
        ({
          ...(value as SuggestionInstance),
          id: 'existing-on-demand',
          created_at: new Date('2026-05-06T10:10:00.000Z'),
          updated_at: new Date('2026-05-06T10:15:00.000Z'),
          steps: [],
        }) as unknown as SuggestionInstance,
    );

    const result = await service.retryFailed(user(), 'existing-on-demand');

    expect(txSuggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing-on-demand',
        generation_status: 'generating',
        ai_error: null,
        ai_retry_count: 0,
      }),
    );
    expect(txJobRepo.update).toHaveBeenCalledWith(
      { id: 'job-on-demand-1' },
      expect.objectContaining({
        status: 'queued',
        attempt_count: 0,
        locked_at: null,
        locked_by: null,
        last_error: null,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'existing-on-demand',
        generationStatus: 'generating',
      }),
    );
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'on_demand_retry_requested',
        suggestionInstanceId: 'existing-on-demand',
      }),
    );
  });

  it('blocks on-demand suggestions while the routine is paused', async () => {
    routineBreakService.isRoutineBreakActive.mockResolvedValue(true);

    await expect(
      service.create(user(), null, {
        intent: 'quick_refresh',
      }),
    ).rejects.toBeInstanceOf(HttpException);

    expect(consentService.evaluate).not.toHaveBeenCalled();
    expect(txSuggestionRepo.save).not.toHaveBeenCalled();
    expect(txJobRepo.insert).not.toHaveBeenCalled();
  });

  it('requires explicit AI suggestion consent', async () => {
    consentService.evaluate.mockResolvedValue({
      aiPersonalizationAllowed: false,
      canReadSensitiveContext: false,
      blockedReason: 'ai_suggestion_processing_consent_missing',
      grantedAt: null,
      activeSensitiveConsentTypes: [],
    });

    await expect(
      service.create(user(), null, {
        intent: 'event_prep',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'consent_degraded',
        severity: 'warning',
      }),
    );
    expect(usageGuard.evaluate).not.toHaveBeenCalled();
  });

  it('blocks daily AI cap and empty shelf requests before enqueueing work', async () => {
    usageGuard.evaluate.mockResolvedValueOnce({
      allowed: false,
      blockedReason: 'daily_generation_limit',
      generationCountToday: 12,
      regenerationCountToday: 0,
      estimatedCostTodayUsd: 0.5,
    });

    await expect(
      service.create(user(), null, {
        intent: 'post_sun',
      }),
    ).rejects.toBeInstanceOf(HttpException);

    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ai_budget_blocked',
        severity: 'warning',
      }),
    );
    expect(txSuggestionRepo.save).not.toHaveBeenCalled();

    usageGuard.evaluate.mockResolvedValue({
      allowed: true,
      blockedReason: null,
      generationCountToday: 0,
      regenerationCountToday: 0,
      estimatedCostTodayUsd: 0,
    });
    inventoryRepo.count.mockResolvedValue(0);

    await expect(
      service.create(user(), null, {
        intent: 'quick_refresh',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks the daily on-demand request limit', async () => {
    suggestionRepo.count.mockResolvedValue(5);

    await expect(
      service.create(user(), null, {
        intent: 'quick_refresh',
      }),
    ).rejects.toBeInstanceOf(HttpException);

    expect(txSuggestionRepo.save).not.toHaveBeenCalled();
    expect(txJobRepo.insert).not.toHaveBeenCalled();
  });

  it('blocks repeated requests inside the cooldown window', async () => {
    suggestionRepo.findOne.mockResolvedValue({
      id: 'recent-suggestion',
      created_at: new Date('2026-05-06T10:14:00.000Z'),
    } as SuggestionInstance);

    await expect(
      service.create(user(), null, {
        intent: 'post_workout',
      }),
    ).rejects.toBeInstanceOf(HttpException);

    expect(txSuggestionRepo.save).not.toHaveBeenCalled();
    expect(txJobRepo.insert).not.toHaveBeenCalled();
  });

  it('normalizes optional request context before encryptable persistence', async () => {
    await service.create(user(), 'Europe/Stockholm', {
      intent: 'post_sun',
      activityAt: '2026-05-06T09:45:00.000Z',
      note: '   ',
    });

    expect(txSuggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        request_context: expect.objectContaining({
          intent: 'post_sun',
          intensity: 'standard',
          note: null,
          activityAt: '2026-05-06T09:45:00.000Z',
          requestedAt: '2026-05-06T10:15:00.000Z',
        }),
      }),
    );
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    count: jest.fn(),
    create: jest.fn((value) => value),
    findOne: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function dataSourceWithRepos(
  txSuggestionRepo: jest.Mocked<Repository<SuggestionInstance>>,
  txJobRepo: jest.Mocked<Repository<SuggestionGenerationJob>>,
): jest.Mocked<DataSource> {
  const manager = {
    getRepository: jest.fn((target: EntityTarget<ObjectLiteral>) => {
      if (target === SuggestionInstance) return txSuggestionRepo;
      if (target === SuggestionGenerationJob) return txJobRepo;
      throw new Error('Unexpected repository requested in test');
    }),
  };
  return {
    transaction: jest.fn((callback) => callback(manager)),
  } as unknown as jest.Mocked<DataSource>;
}

function user(): User {
  return {
    id: 'user-1',
    time_zone: 'Europe/Stockholm',
  } as User;
}

function existingSuggestion(
  overrides: Partial<SuggestionInstance> = {},
): SuggestionInstance {
  return {
    id: 'existing-on-demand',
    user_id: 'user-1',
    slot_id: null,
    request_source: 'on_demand',
    request_id: 'quick-existing',
    request_context: null,
    target_date: '2026-05-06',
    target_time: '12:10',
    daypart: 'noon',
    mode: 'ai',
    generation_status: 'generating',
    visible_at: new Date('2026-05-06T10:10:00.000Z'),
    generated_at: null,
    ai_model: null,
    ai_prompt_version: null,
    has_reaction_signal: false,
    simplified_for_reaction: false,
    steps: [],
    created_at: new Date('2026-05-06T10:10:00.000Z'),
    updated_at: new Date('2026-05-06T10:10:00.000Z'),
    ...overrides,
  } as SuggestionInstance;
}
