import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SuggestionGapAction } from '../../suggestions/entities/suggestion-gap-action.entity';
import { User } from '../../users/entities/user.entity';
import { SmartPickProductSuggestion } from '../entities/smart-pick-product-suggestion.entity';
import { SmartPicksWishlistItem } from '../smart-picks.types';
import { toProductPick } from './smart-picks-overview.service';

@Injectable()
export class SmartPicksWishlistService {
  constructor(
    @InjectRepository(SuggestionGapAction)
    private readonly gapActionRepo: Repository<SuggestionGapAction>,
    @InjectRepository(SmartPickProductSuggestion)
    private readonly productSuggestionRepo: Repository<SmartPickProductSuggestion>,
  ) {}

  async list(user: User): Promise<SmartPicksWishlistItem[]> {
    const actions = await this.gapActionRepo.find({
      where: {
        user_id: user.id,
        source_type: 'smart_pick',
        action: 'saved',
      },
      order: { updated_at: 'DESC' },
    });
    const suggestionIds = actions
      .map((action) => action.smart_pick_product_suggestion_id)
      .filter((id): id is string => Boolean(id));
    if (suggestionIds.length === 0) return [];

    const suggestions = await this.productSuggestionRepo.find({
      where: { id: In(suggestionIds), user_id: user.id },
    });
    const byId = new Map(
      suggestions.map((suggestion) => [suggestion.id, suggestion]),
    );
    return actions.flatMap((action) => {
      const suggestionId = action.smart_pick_product_suggestion_id;
      const suggestion = suggestionId ? byId.get(suggestionId) : null;
      if (!suggestion) return [];
      return [
        {
          actionId: action.id,
          savedAt: action.updated_at.toISOString(),
          ingredientOrCategory: action.ingredient_or_category,
          normalizedKey: action.normalized_key,
          reason: suggestion.gap_reason,
          goalAlignment: suggestion.goal_alignment,
          pick: toProductPick(suggestion, 'saved'),
        },
      ];
    });
  }

  async remove(user: User, actionId: string): Promise<void> {
    const action = await this.gapActionRepo.findOne({
      where: {
        id: actionId,
        user_id: user.id,
        source_type: 'smart_pick',
        action: 'saved',
      },
    });
    if (!action) {
      throw new NotFoundException('Wishlist item not found.');
    }
    await this.gapActionRepo.remove(action);
  }
}
