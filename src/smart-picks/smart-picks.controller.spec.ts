import { SmartPicksBudgetTier, SmartPicksOverview } from './smart-picks.types';
import { SmartPicksOverviewService } from './services/smart-picks-overview.service';
import { SmartPicksWishlistService } from './services/smart-picks-wishlist.service';
import { SmartPicksController } from './smart-picks.controller';
import { User } from '../users/entities/user.entity';

describe('SmartPicksController', () => {
  const overviewService = {
    getOverview: jest.fn(),
    updateBudget: jest.fn(),
  };
  const wishlistService = {
    list: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new SmartPicksController(
    overviewService as unknown as SmartPicksOverviewService,
    wishlistService as unknown as SmartPicksWishlistService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns overview data including starter kit state', async () => {
    overviewService.getOverview.mockResolvedValue(overview());

    const response = await controller.getOverview(user(), { mode: 'starter' });

    expect(overviewService.getOverview).toHaveBeenCalledWith(user(), 'starter');
    expect(response).toEqual(
      expect.objectContaining({
        mode: 'starter',
        starterKit: expect.objectContaining({
          summary: 'Starter summary',
          steps: [],
        }),
      }),
    );
  });

  it('returns saved wishlist items from the wishlist service', async () => {
    wishlistService.list.mockResolvedValue([
      {
        actionId: 'action-1',
        savedAt: '2026-05-12T09:00:00.000Z',
        ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
        normalizedKey: 'broad-spectrum-sunscreen-spf-30',
        reason: 'No SPF on shelf.',
        goalAlignment: 'sun protection',
        pick: { id: 'pick-1', productName: 'Mineral SPF 50' },
      },
    ]);

    const response = await controller.getWishlist(user());

    expect(wishlistService.list).toHaveBeenCalledWith(user());
    expect(response.items).toEqual([
      expect.objectContaining({
        normalizedKey: 'broad-spectrum-sunscreen-spf-30',
      }),
    ]);
  });

  it('removes a wishlist item for the current user', async () => {
    await controller.removeWishlistItem(user(), 'action-1');

    expect(wishlistService.remove).toHaveBeenCalledWith(user(), 'action-1');
  });

  it('updates the active budget tier through the overview service', async () => {
    overviewService.updateBudget.mockResolvedValue(
      overview({ recap: { ...overview().recap, budgetTier: 'premium' } }),
    );

    const response = await controller.updateBudget(user(), {
      budgetTier: 'premium',
    });

    expect(overviewService.updateBudget).toHaveBeenCalledWith(
      user(),
      'premium',
    );
    expect(response.recap.budgetTier).toBe('premium');
  });
});

function user(): User {
  return { id: 'user-1', time_zone: 'Europe/Stockholm' } as User;
}

function overview(
  overrides: Partial<SmartPicksOverview> = {},
): SmartPicksOverview {
  return {
    mode: 'starter',
    generatedAt: '2026-05-12T09:00:00.000Z',
    inputsHash: 'hash-1',
    recap: {
      primaryGoal: 'fade dark marks',
      skinType: 'combination',
      location: { city: 'Stockholm', countryCode: 'SE' },
      budgetTier: 'mid',
      ethnicity: 'Yoruba',
    },
    coverage: { slots: [], filled: 0, total: 0 },
    priorityGaps: [],
    considerGaps: [],
    covered: [],
    redundancy: [],
    consentRequired: false,
    skinProfileRequired: false,
    productSuggestionsUnavailable: false,
    emptyState: {
      reason: null,
      dismissedGapCount: 0,
      nextEligibleAt: null,
      missingProfileFields: [],
      activeProductCount: 0,
      canAssessReplacements: false,
      historyReadiness: {
        usablePhotoCheckpoints: 0,
        loggedUseDaysLast90: 0,
        canAssessReplacements: false,
        reason: 'needs_usage_and_photos',
      },
    },
    starterKit: { summary: 'Starter summary', steps: [] },
    ...overrides,
  };
}
