import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SuggestionGapAction } from '../../suggestions/entities/suggestion-gap-action.entity';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { User } from '../../users/entities/user.entity';
import { SmartPickProductSuggestion } from '../entities/smart-pick-product-suggestion.entity';
import { SmartPicksWishlistService } from './smart-picks-wishlist.service';

describe('SmartPicksWishlistService', () => {
  it('returns saved Smart Picks joined to current-user product suggestions', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    actions.find.mockResolvedValue([
      action({ id: 'action-1', smart_pick_product_suggestion_id: 'pick-1' }),
      action({ id: 'action-2', smart_pick_product_suggestion_id: null }),
      action({ id: 'action-3', smart_pick_product_suggestion_id: 'missing' }),
    ]);
    suggestions.find.mockResolvedValue([productSuggestion()]);
    const service = new SmartPicksWishlistService(actions, suggestions);

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

  it('returns an empty wishlist without reading suggestions when no saved action has a product id', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    actions.find.mockResolvedValue([
      action({ id: 'action-1', smart_pick_product_suggestion_id: null }),
    ]);
    const service = new SmartPicksWishlistService(actions, suggestions);

    await expect(service.list(user())).resolves.toEqual([]);
    expect(suggestions.find).not.toHaveBeenCalled();
  });

  it('removes a saved wishlist action owned by the current user', async () => {
    const actions = repo<SuggestionGapAction>();
    const suggestions = repo<SmartPickProductSuggestion>();
    const savedAction = action();
    actions.findOne.mockResolvedValue(savedAction);
    actions.remove.mockResolvedValue(savedAction);
    const service = new SmartPicksWishlistService(actions, suggestions);

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
    actions.findOne.mockResolvedValue(null);
    const service = new SmartPicksWishlistService(actions, suggestions);

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
    price_cents: 2200,
    currency: 'USD',
    retailers_json: [],
    reasoning_chips_json: [],
    reasoning_facts_json: {},
    ruled_out_json: [],
    alternatives_json: [],
    source_ids: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    verification_status: 'ai_named',
    availability_status: 'local',
    recommendation_rank_reason: 'Best local SPF fit.',
    local_alternative_reason: null,
    retailer_data_checked_at: new Date('2026-05-12T09:00:00.000Z'),
    retailer_data_expires_at: new Date('2099-05-19T09:00:00.000Z'),
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
