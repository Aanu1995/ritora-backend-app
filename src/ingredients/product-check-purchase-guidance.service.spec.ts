import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { ProductCheckPurchaseGuidanceService } from './product-check-purchase-guidance.service';
import {
  ProductCheckAlternativeSource,
  ProductCheckPersonalizationLevel,
  ProductCheckPurchaseGuidanceReasonCode,
  ProductCheckVerdict,
} from './product-check.types';

describe('ProductCheckPurchaseGuidanceService', () => {
  const smartPickSnapshotRepository = {
    find: jest.fn(),
  };
  const smartPickProductSuggestionRepository = {
    find: jest.fn(),
  };
  const dataAccessLogService = {
    recordDataAccess: jest.fn(),
  };
  let service: ProductCheckPurchaseGuidanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductCheckPurchaseGuidanceService(
      smartPickSnapshotRepository as never,
      smartPickProductSuggestionRepository as never,
      dataAccessLogService as never,
    );
    smartPickSnapshotRepository.find.mockResolvedValue([]);
    smartPickProductSuggestionRepository.find.mockResolvedValue([]);
    dataAccessLogService.recordDataAccess.mockResolvedValue(undefined);
  });

  it('returns reasons without alternatives when smart-pick context is not consented', async () => {
    const result = await service.loadForUser({
      userId: 'user-1',
      skinProfile: null,
      activeConsentTypes: new Set(),
      context: {
        level: ProductCheckPersonalizationLevel.Educational,
        usedSignals: [],
        missingSignals: [],
        activeShelfProductCount: 0,
        recentJournalReactionCount: 0,
        recentSuggestionReactionCount: 0,
      },
      verdictLabel: ProductCheckVerdict.UseCarefully,
      overlapCount: 1,
    });

    expect(result).toEqual({
      shouldConsiderAlternatives: true,
      reasonCodes: [
        ProductCheckPurchaseGuidanceReasonCode.HigherRisk,
        ProductCheckPurchaseGuidanceReasonCode.DuplicateExposure,
        ProductCheckPurchaseGuidanceReasonCode.MissingPersonalContext,
      ],
      alternatives: [],
    });
    expect(smartPickSnapshotRepository.find).not.toHaveBeenCalled();
  });

  it('returns direct Smart Picks alternatives when purchase guidance is useful and consented', async () => {
    const skinProfile = Object.assign(new SkinProfile(), {
      allow_smart_picks: true,
    });
    smartPickSnapshotRepository.find.mockResolvedValue([
      {
        user_id: 'user-1',
        mode: 'refine',
        inputs_hash: 'inputs-1',
        generated_at: new Date('2026-05-17T10:00:00.000Z'),
      },
    ]);
    smartPickProductSuggestionRepository.find.mockResolvedValue([
      {
        id: 'pick-1',
        ingredient_or_category: 'Barrier moisturizer',
        brand: 'Calm Lab',
        product_name: 'Barrier Cream',
        budget_tier: 'mid',
        seller_names_json: ['Pharmacy'],
        gap_reason: 'Covers a barrier gap without duplicating actives.',
        recommendation_rank_reason: 'Best fit for a low-irritation routine.',
      },
    ]);

    const result = await service.loadForUser({
      userId: 'user-1',
      skinProfile,
      activeConsentTypes: new Set([UserConsentType.AiSuggestionProcessing]),
      context: {
        level: ProductCheckPersonalizationLevel.Personalized,
        usedSignals: [],
        missingSignals: [],
        activeShelfProductCount: 0,
        recentJournalReactionCount: 0,
        recentSuggestionReactionCount: 0,
      },
      verdictLabel: ProductCheckVerdict.UseCarefully,
      overlapCount: 0,
    });

    expect(result).toEqual(
      expect.objectContaining({
        shouldConsiderAlternatives: true,
        reasonCodes: expect.arrayContaining([
          ProductCheckPurchaseGuidanceReasonCode.HigherRisk,
          ProductCheckPurchaseGuidanceReasonCode.SmartPicksAvailable,
        ]),
        alternatives: [
          {
            id: 'pick-1',
            source: ProductCheckAlternativeSource.SmartPicks,
            brand: 'Calm Lab',
            productName: 'Barrier Cream',
            ingredientOrCategory: 'Barrier moisturizer',
            budgetTier: 'mid',
            sellerNames: ['Pharmacy'],
            reason: 'Covers a barrier gap without duplicating actives.',
          },
        ],
      }),
    );
    expect(dataAccessLogService.recordDataAccess).toHaveBeenCalledWith(
      'user-1',
      [UserConsentType.AiSuggestionProcessing],
      UserDataAccessPurpose.RecommendationAnalysis,
    );
  });
});
