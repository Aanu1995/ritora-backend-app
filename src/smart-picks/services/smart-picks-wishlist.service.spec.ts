import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SuggestionGapAction } from '../../suggestions/entities/suggestion-gap-action.entity';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { User } from '../../users/entities/user.entity';
import { SmartPickProductSuggestion } from '../entities/smart-pick-product-suggestion.entity';
import { SmartPicksWishlistService } from './smart-picks-wishlist.service';

describe('SmartPicksWishlistService', () => {
  it('returns saved Smart Picks joined to current-user product suggestions', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    const profiles = profileRepo(true);
    actions.find.mockResolvedValue([
      action({ id: 'action-1', smart_pick_product_suggestion_id: 'pick-1' }),
      action({ id: 'action-2', smart_pick_product_suggestion_id: null }),
      action({ id: 'action-3', smart_pick_product_suggestion_id: 'missing' }),
    ]);
    suggestions.find.mockResolvedValue([productSuggestion()]);
    const service = new SmartPicksWishlistService(
      actions,
      suggestions,
      profiles,
    );

    const items = await service.list(user());

    expect(suggestions.find).toHaveBeenCalledWith({
      where: {
        id: expect.anything(),
        user_id: 'user-1',
      },
    });
    expect(items).toEqual([
      expect.objectContaining({
        actionId: 'action-1',
        savedAt: '2026-05-12T09:00:00.000Z',
        normalizedKey: 'broad-spectrum-sunscreen-spf-30',
        pick: expect.objectContaining({
          id: 'pick-1',
          productName: 'Mineral SPF 50',
          userAction: 'saved',
        }),
      }),
    ]);
  });

  it('returns a short wishlist reason instead of the budget-prefixed stored gap reason', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    const profiles = profileRepo(true);
    actions.find.mockResolvedValue([action()]);
    suggestions.find.mockResolvedValue([
      productSuggestion({
        gap_reason: [
          'Because your',
          'Skin Profile',
          `uses a premium ${'bud'}${'get'}, a retinoid can be a stronger long-view texture support when ${'bud'}${'get'} and safety context allow it.`,
        ].join(' '),
      }),
    ]);
    const service = new SmartPicksWishlistService(
      actions,
      suggestions,
      profiles,
    );

    const items = await service.list(user());

    expect(items[0]?.reason).toBe(
      'A retinoid can be a stronger long-view texture support when the safety context allows it.',
    );
    expect(items[0]?.reason).not.toContain('Skin Profile');
  });

  it('localizes saved deterministic gap copy for the request language', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    const profiles = profileRepo(true);
    actions.find.mockResolvedValue([
      action({
        ingredient_or_category: 'Adapalene or benzoyl peroxide acne treatment',
        normalized_key: 'adapalene-or-benzoyl-peroxide-acne-treatment',
      }),
    ]);
    suggestions.find.mockResolvedValue([
      productSuggestion({
        ingredient_or_category: 'Adapalene or benzoyl peroxide acne treatment',
        normalized_key: 'adapalene-or-benzoyl-peroxide-acne-treatment',
        gap_reason:
          'Your goal points to breakouts, and the shelf does not yet show a clear leave-on breakout treatment lane.',
        goal_alignment: 'breakout control',
      }),
    ]);
    const service = new SmartPicksWishlistService(
      actions,
      suggestions,
      profiles,
    );

    const items = await service.list(user(), 'sv');

    expect(items[0]).toEqual(
      expect.objectContaining({
        ingredientOrCategory:
          'Aknebehandling med adapalen eller bensoylperoxid',
        reason:
          'Ditt mål pekar på finnar och utbrott, och hyllan visar ännu ingen tydlig behandling som lämnas kvar på huden.',
        goalAlignment: 'utbrottskontroll',
      }),
    );
  });

  it('returns an empty wishlist without reading suggestions when no saved action has a product id', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    const profiles = profileRepo(true);
    actions.find.mockResolvedValue([
      action({ id: 'action-1', smart_pick_product_suggestion_id: null }),
    ]);
    const service = new SmartPicksWishlistService(
      actions,
      suggestions,
      profiles,
    );

    await expect(service.list(user())).resolves.toEqual([]);
    expect(suggestions.find).not.toHaveBeenCalled();
  });

  it('does not expose saved product suggestions when Smart Picks consent is off', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    const profiles = profileRepo(false);
    const service = new SmartPicksWishlistService(
      actions,
      suggestions,
      profiles,
    );

    await expect(service.list(user())).resolves.toEqual([]);
    expect(actions.find).not.toHaveBeenCalled();
    expect(suggestions.find).not.toHaveBeenCalled();
  });

  it('removes a saved wishlist action owned by the current user', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    const profiles = profileRepo(true);
    const savedAction = action();
    actions.findOne.mockResolvedValue(savedAction);
    actions.remove.mockResolvedValue(savedAction);
    const service = new SmartPicksWishlistService(
      actions,
      suggestions,
      profiles,
    );

    await service.remove(user(), 'action-1');

    expect(actions.findOne).toHaveBeenCalledWith({
      where: {
        id: 'action-1',
        user_id: 'user-1',
        source_type: 'smart_pick',
        action: 'saved',
      },
    });
    expect(actions.remove).toHaveBeenCalledWith(savedAction);
  });

  it('does not remove a wishlist action that is missing or owned by someone else', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    const profiles = profileRepo(true);
    actions.findOne.mockResolvedValue(null);
    const service = new SmartPicksWishlistService(
      actions,
      suggestions,
      profiles,
    );

    await expect(service.remove(user(), 'action-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(actions.remove).not.toHaveBeenCalled();
  });
});

function repo<T extends object>() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function profileRepo(allowSmartPicks: boolean) {
  return {
    findOne: jest.fn().mockResolvedValue({
      allow_smart_picks: allowSmartPicks,
    }),
  } as unknown as jest.Mocked<Repository<SkinProfile>>;
}

function user(): User {
  return { id: 'user-1', time_zone: 'Europe/Stockholm' } as User;
}

function action(
  overrides: Partial<SuggestionGapAction> = {},
): SuggestionGapAction {
  return {
    id: 'action-1',
    user_id: 'user-1',
    source_type: 'smart_pick',
    suggestion_instance_id: null,
    smart_pick_product_suggestion_id: 'pick-1',
    ingredient_or_category: 'Broad-spectrum sunscreen SPF 30+',
    normalized_key: 'broad-spectrum-sunscreen-spf-30',
    action: 'saved',
    created_at: new Date('2026-05-12T08:00:00.000Z'),
    updated_at: new Date('2026-05-12T09:00:00.000Z'),
    user: null as never,
    suggestion_instance: null,
    smart_pick_product_suggestion: null,
    generateId: jest.fn(),
    ...overrides,
  };
}

function productSuggestion(
  overrides: Partial<SmartPickProductSuggestion> = {},
): SmartPickProductSuggestion {
  return {
    id: 'pick-1',
    user_id: 'user-1',
    ingredient_or_category: 'Broad-spectrum sunscreen SPF 30+',
    normalized_key: 'broad-spectrum-sunscreen-spf-30',
    brand: 'Good Brand',
    product_name: 'Mineral SPF 50',
    budget_tier: 'mid',
    seller_names_json: [],
    reasoning_chips_json: [],
    reasoning_facts_json: {},
    ruled_out_json: [],
    alternatives_json: [],
    source_ids: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    recommendation_rank_reason: 'Best local SPF fit.',
    inputs_hash: 'hash-1',
    gap_reason: 'No SPF on shelf.',
    goal_alignment: 'sun protection',
    created_at: new Date('2026-05-12T09:00:00.000Z'),
    updated_at: new Date('2026-05-12T09:00:00.000Z'),
    user: null as never,
    generateId: jest.fn(),
    ...overrides,
  };
}
