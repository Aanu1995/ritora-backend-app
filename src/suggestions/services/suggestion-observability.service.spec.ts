import { ObjectLiteral, Repository } from 'typeorm';
import { SuggestionObservabilityEvent } from '../entities/suggestion-observability-event.entity';
import { SuggestionObservabilityService } from './suggestion-observability.service';

describe('SuggestionObservabilityService', () => {
  const eventRepo = repo<SuggestionObservabilityEvent>();
  const service = new SuggestionObservabilityService(eventRepo);

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
