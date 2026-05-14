import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppLanguage, normalizeLanguage } from '../../common/i18n/i18n';
import { SuggestionGapAction } from '../../suggestions/entities/suggestion-gap-action.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { User } from '../../users/entities/user.entity';
import { SmartPickProductSuggestion } from '../entities/smart-pick-product-suggestion.entity';
import { SmartPicksWishlistItem } from '../smart-picks.types';
import { localizeSmartPicksGapText } from './smart-picks-localization';
import {
  buildShortGapReason,
  toProductPick,
} from './smart-picks-overview.service';

@Injectable()
export class SmartPicksWishlistService {
  constructor(
    @InjectRepository(SuggestionGapAction)
    private readonly gapActionRepo: Repository<SuggestionGapAction>,
    @InjectRepository(SmartPickProductSuggestion)
    private readonly productSuggestionRepo: Repository<SmartPickProductSuggestion>,
    @InjectRepository(SkinProfile)
    private readonly skinProfileRepo: Repository<SkinProfile>,
  ) {}

  async list(
    user: User,
    language: AppLanguage = normalizeLanguage(user.preferred_language),
  ): Promise<SmartPicksWishlistItem[]> {
    if (!(await this.hasSmartPicksConsent(user.id))) {
      return [];
    }
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
      const reason = suggestion.gap_reason
        ? buildShortGapReason(suggestion.gap_reason)
        : null;
      const localizedGap = localizeSmartPicksGapText(
        {
          normalizedKey: action.normalized_key,
          ingredientOrCategory: action.ingredient_or_category,
          reason: reason ?? '',
          shortReason: reason ?? '',
          goalAlignment: suggestion.goal_alignment,
        },
        language,
      );
      return [
        {
          actionId: action.id,
          savedAt: action.updated_at.toISOString(),
          ingredientOrCategory: localizedGap.ingredientOrCategory,
          normalizedKey: action.normalized_key,
          reason: reason ? localizedGap.shortReason : null,
          goalAlignment: localizedGap.goalAlignment,
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

  private async hasSmartPicksConsent(userId: string): Promise<boolean> {
    const profile = await this.skinProfileRepo.findOne({
      where: { user_id: userId },
    });
    return profile?.allow_smart_picks === true;
  }
}
