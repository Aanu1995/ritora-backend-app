import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SmartPickProductSuggestion } from '../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../smart-picks/entities/smart-pick-snapshot.entity';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  ProductCheckAlternativeSource,
  ProductCheckPersonalizationLevel,
  ProductCheckPurchaseGuidanceReasonCode,
  ProductCheckVerdict,
  type ProductCheckAlternative,
  type ProductCheckContextSummary,
  type ProductCheckPurchaseGuidance,
} from './product-check.types';

const SMART_PICK_SNAPSHOT_LIMIT = 2;
const SMART_PICK_ALTERNATIVE_LIMIT = 3;

@Injectable()
export class ProductCheckPurchaseGuidanceService {
  constructor(
    @InjectRepository(SmartPickSnapshot)
    private readonly smartPickSnapshots: Repository<SmartPickSnapshot>,
    @InjectRepository(SmartPickProductSuggestion)
    private readonly smartPickProductSuggestions: Repository<SmartPickProductSuggestion>,
    private readonly dataAccessLogService: UserDataAccessLogService,
  ) {}

  async loadForUser(input: {
    userId: string;
    skinProfile: SkinProfile | null;
    activeConsentTypes: ReadonlySet<UserConsentType>;
    context: ProductCheckContextSummary;
    verdictLabel: ProductCheckVerdict;
    overlapCount: number;
  }): Promise<ProductCheckPurchaseGuidance> {
    const reasonCodes = resolvePurchaseGuidanceReasonCodes(input);
    const shouldConsiderAlternatives = reasonCodes.length > 0;
    const alternatives = shouldConsiderAlternatives
      ? await this.loadSmartPickAlternatives(input)
      : [];

    return {
      shouldConsiderAlternatives,
      reasonCodes:
        alternatives.length > 0
          ? [
              ...new Set([
                ...reasonCodes,
                ProductCheckPurchaseGuidanceReasonCode.SmartPicksAvailable,
              ]),
            ]
          : reasonCodes,
      alternatives,
    };
  }

  private async loadSmartPickAlternatives(input: {
    userId: string;
    skinProfile: SkinProfile | null;
    activeConsentTypes: ReadonlySet<UserConsentType>;
  }): Promise<ProductCheckAlternative[]> {
    if (
      !input.activeConsentTypes.has(UserConsentType.AiSuggestionProcessing) ||
      !input.skinProfile ||
      input.skinProfile.allow_smart_picks === false
    ) {
      return [];
    }

    const snapshots = await this.smartPickSnapshots.find({
      where: { user_id: input.userId },
      order: { generated_at: 'DESC' },
      take: SMART_PICK_SNAPSHOT_LIMIT,
    });
    const snapshot =
      snapshots.find((item) => item.mode === 'refine') ?? snapshots[0];
    if (!snapshot) {
      return [];
    }

    const suggestions = await this.smartPickProductSuggestions.find({
      where: {
        user_id: input.userId,
        inputs_hash: snapshot.inputs_hash,
      },
      order: { created_at: 'DESC' },
      take: SMART_PICK_ALTERNATIVE_LIMIT,
    });

    if (suggestions.length > 0) {
      await this.dataAccessLogService.recordDataAccess(
        input.userId,
        [UserConsentType.AiSuggestionProcessing],
        UserDataAccessPurpose.RecommendationAnalysis,
      );
    }

    return suggestions.map(toProductCheckAlternative);
  }
}

function resolvePurchaseGuidanceReasonCodes(input: {
  context: ProductCheckContextSummary;
  verdictLabel: ProductCheckVerdict;
  overlapCount: number;
}): ProductCheckPurchaseGuidanceReasonCode[] {
  const reasonCodes: ProductCheckPurchaseGuidanceReasonCode[] = [];

  if (
    [
      ProductCheckVerdict.AvoidForProfile,
      ProductCheckVerdict.UseCarefully,
    ].includes(input.verdictLabel)
  ) {
    reasonCodes.push(ProductCheckPurchaseGuidanceReasonCode.HigherRisk);
  }

  if (input.overlapCount > 0) {
    reasonCodes.push(ProductCheckPurchaseGuidanceReasonCode.DuplicateExposure);
  }

  if (input.context.level === ProductCheckPersonalizationLevel.Educational) {
    reasonCodes.push(
      ProductCheckPurchaseGuidanceReasonCode.MissingPersonalContext,
    );
  }

  return [...new Set(reasonCodes)];
}

function toProductCheckAlternative(
  suggestion: SmartPickProductSuggestion,
): ProductCheckAlternative {
  return {
    id: suggestion.id,
    source: ProductCheckAlternativeSource.SmartPicks,
    brand: suggestion.brand,
    productName: suggestion.product_name,
    ingredientOrCategory: suggestion.ingredient_or_category,
    budgetTier: suggestion.budget_tier,
    sellerNames: suggestion.seller_names_json ?? [],
    reason:
      suggestion.gap_reason ??
      suggestion.recommendation_rank_reason ??
      suggestion.goal_alignment,
  };
}
