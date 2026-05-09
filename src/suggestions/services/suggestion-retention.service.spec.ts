import { ObjectLiteral, Repository } from 'typeorm';
import { EnvironmentLocationCache } from '../../environment-intelligence/entities/environment-location-cache.entity';
import { EnvironmentSnapshot } from '../../environment-intelligence/entities/environment-snapshot.entity';
import { SuggestionContextCache } from '../entities/suggestion-context-cache.entity';
import { SuggestionGapAction } from '../entities/suggestion-gap-action.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionReactionOverride } from '../entities/suggestion-reaction-override.entity';
import { SuggestionRecordingReminderSnooze } from '../entities/suggestion-recording-reminder-snooze.entity';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { SuggestionRetentionService } from './suggestion-retention.service';

describe('SuggestionRetentionService', () => {
  const cacheRepo = repo<SuggestionContextCache>();
  const suggestionRepo = repo<SuggestionInstance>();
  const gapActionRepo = repo<SuggestionGapAction>();
  const overrideRepo = repo<SuggestionReactionOverride>();
  const reminderSnoozeRepo = repo<SuggestionRecordingReminderSnooze>();
  const environmentLocationRepo = repo<EnvironmentLocationCache>();
  const environmentSnapshotRepo = repo<EnvironmentSnapshot>();
  const observability = {
    record: jest.fn(),
  } as unknown as jest.Mocked<SuggestionObservabilityService>;
  const queryBuilder = updateQueryBuilder();
  const service = new SuggestionRetentionService(
    cacheRepo,
    suggestionRepo,
    gapActionRepo,
    overrideRepo,
    reminderSnoozeRepo,
    environmentLocationRepo,
    environmentSnapshotRepo,
    observability,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    cacheRepo.delete.mockResolvedValue({ affected: 2, raw: [] });
    gapActionRepo.delete.mockResolvedValue({ affected: 0, raw: [] });
    overrideRepo.delete.mockResolvedValue({ affected: 1, raw: [] });
    reminderSnoozeRepo.delete.mockResolvedValue({ affected: 1, raw: [] });
    environmentLocationRepo.delete.mockResolvedValue({ affected: 1, raw: [] });
    environmentSnapshotRepo.delete.mockResolvedValue({ affected: 2, raw: [] });
    suggestionRepo.createQueryBuilder.mockReturnValue(queryBuilder as never);
    queryBuilder.execute.mockResolvedValue({
      affected: 3,
      raw: [],
      generatedMaps: [],
    });
  });

  it('purges expired context caches and clears old AI context snapshots', async () => {
    await expect(
      service.purgeExpiredSensitiveData(new Date('2026-05-04T00:00:00.000Z')),
    ).resolves.toEqual({
      contextCachesDeleted: 2,
      sensitiveSuggestionFieldsCleared: 3,
      environmentSnapshotsDeleted: 2,
      environmentLocationCachesDeleted: 1,
    });

    expect(cacheRepo.delete).toHaveBeenCalled();
    expect(environmentSnapshotRepo.delete).toHaveBeenCalledWith({
      created_at: expect.any(Object),
    });
    expect(environmentLocationRepo.delete).toHaveBeenCalled();
    expect(queryBuilder.set).toHaveBeenCalledWith({
      ai_explanation: null,
      generation_context: null,
      request_context: null,
    });
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'retention_purged',
        metadata: {
          contextCachesDeleted: 2,
          sensitiveSuggestionFieldsCleared: 3,
          environmentSnapshotsDeleted: 2,
          environmentLocationCachesDeleted: 1,
        },
      }),
    );
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    createQueryBuilder: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function updateQueryBuilder() {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };
}
