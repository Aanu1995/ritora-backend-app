import { ObjectLiteral, Repository } from 'typeorm';
import { SuggestionObservabilityEvent } from '../entities/suggestion-observability-event.entity';
import { SuggestionObservabilityAlertService } from './suggestion-observability-alert.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';

describe('SuggestionObservabilityService', () => {
  const eventRepo = repo<SuggestionObservabilityEvent>();
  const alertService = {
    notify: jest.fn(),
  } as unknown as jest.Mocked<SuggestionObservabilityAlertService>;
  const service = new SuggestionObservabilityService(eventRepo, alertService);

  beforeEach(() => {
    jest.clearAllMocks();
    eventRepo.create.mockImplementation(
      (value) => value as SuggestionObservabilityEvent,
    );
    eventRepo.save.mockResolvedValue({} as SuggestionObservabilityEvent);
  });

  it('stores compact operational events for dashboarding and alerts', async () => {
    await service.record({
      kind: 'generation_failed',
      severity: 'critical',
      userId: 'user-1',
      jobId: 'job-1',
      metadata: { message: 'timeout', attemptCount: 3 },
    });

    expect(eventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        job_id: 'job-1',
        kind: 'generation_failed',
        severity: 'critical',
        metadata: { message: 'timeout', attemptCount: 3 },
      }),
    );
  });

  it('routes threshold warnings into the operational alert channel', async () => {
    eventRepo.save.mockImplementation(
      async (event) =>
        ({
          ...event,
          id: 'event-1',
        }) as SuggestionObservabilityEvent,
    );

    await service.record({
      kind: 'generation_context_threshold_exceeded',
      severity: 'warning',
      userId: 'user-1',
      jobId: 'job-1',
      metadata: {
        contextLoadDurationMs: 1700,
        historyRowsWarnThreshold: 1000,
        maxHistoryRows: 1200,
        overDurationThreshold: true,
        overHistoryRowsThreshold: true,
      },
    });

    expect(alertService.notify).toHaveBeenCalledWith({
      eventId: 'event-1',
      kind: 'generation_context_threshold_exceeded',
      severity: 'warning',
      userId: 'user-1',
      suggestionInstanceId: null,
      jobId: 'job-1',
      metadata: {
        contextLoadDurationMs: 1700,
        historyRowsWarnThreshold: 1000,
        maxHistoryRows: 1200,
        overDurationThreshold: true,
        overHistoryRowsThreshold: true,
      },
    });
  });

  it('does not alert for normal informational events', async () => {
    await service.record({
      kind: 'generation_completed',
      severity: 'info',
      userId: 'user-1',
    });

    expect(alertService.notify).not.toHaveBeenCalled();
  });

  it('does not crash the generation path when event persistence fails', async () => {
    eventRepo.save.mockRejectedValue(new Error('db unavailable'));

    await expect(
      service.record({ kind: 'generation_completed' }),
    ).resolves.toBeUndefined();
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    create: jest.fn((value) => value),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}
