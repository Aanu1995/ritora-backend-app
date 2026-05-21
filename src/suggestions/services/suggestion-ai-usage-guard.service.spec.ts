import { ObjectLiteral, Repository } from 'typeorm';
import { PlatformGlobalRestrictionsService } from '../../platform-controls/platform-global-restrictions.service';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SUGGESTION_AI_DAILY_USER_REGENERATION_LIMIT } from '../suggestions.constants';
import { SuggestionAiUsageGuard } from './suggestion-ai-usage-guard.service';

describe('SuggestionAiUsageGuard', () => {
  const suggestionRepo = repo<SuggestionInstance>();
  const queryBuilder = usageQueryBuilder();
  const platformRestrictions = {
    isCapabilityDisabled: jest.fn().mockResolvedValue(false),
  } as unknown as jest.Mocked<PlatformGlobalRestrictionsService>;
  const service = new SuggestionAiUsageGuard(
    suggestionRepo,
    platformRestrictions,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    platformRestrictions.isCapabilityDisabled.mockResolvedValue(false);
    suggestionRepo.createQueryBuilder.mockReturnValue(queryBuilder as never);
  });

  it('allows AI generation when daily use is below limits', async () => {
    queryBuilder.getRawOne.mockResolvedValue({
      generation_count_today: '2',
      regeneration_count_today: '1',
      estimated_cost_today_usd: '0.12',
    });

    await expect(service.evaluate('user-1')).resolves.toEqual({
      allowed: true,
      blockedReason: null,
      generationCountToday: 2,
      regenerationCountToday: 1,
      estimatedCostTodayUsd: 0.12,
    });
  });

  it('blocks repeated regeneration before AI spend can run away', async () => {
    queryBuilder.getRawOne.mockResolvedValue({
      generation_count_today: '5',
      regeneration_count_today: String(
        SUGGESTION_AI_DAILY_USER_REGENERATION_LIMIT,
      ),
      estimated_cost_today_usd: '0.12',
    });

    await expect(service.evaluateRegeneration('user-1')).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        blockedReason: 'daily_regeneration_limit',
      }),
    );
  });

  it('blocks AI generation before querying cost tables when the platform kill switch is active', async () => {
    platformRestrictions.isCapabilityDisabled.mockResolvedValue(true);

    await expect(service.evaluate('user-1')).resolves.toEqual({
      allowed: false,
      blockedReason: 'platform_global_restriction',
      estimatedCostTodayUsd: 0,
      generationCountToday: 0,
      regenerationCountToday: 0,
    });

    expect(suggestionRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    createQueryBuilder: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function usageQueryBuilder() {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };
}
