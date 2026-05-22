import { ApplicationItemStatus } from '../application-tracking/application-tracking.constants';
import { ProductCategory, ShelfStatus } from '../shelf/shelf.types';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { AnalysisConfidence } from './ingredients.types';
import { ProductCheckReactionEvidenceService } from './product-check-reaction-evidence.service';
import { ProductCheckEvidenceKind } from './product-check.types';

describe('ProductCheckReactionEvidenceService', () => {
  const journalRepository = {
    find: jest.fn(),
  };
  const applicationLogItemRepository = {
    createQueryBuilder: jest.fn(),
  };
  const dataAccessLogService = {
    recordDataAccess: jest.fn(),
  };
  const applicationLogQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };
  let service: ProductCheckReactionEvidenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductCheckReactionEvidenceService(
      journalRepository as never,
      applicationLogItemRepository as never,
      dataAccessLogService as never,
    );
    journalRepository.find.mockResolvedValue([]);
    applicationLogItemRepository.createQueryBuilder.mockReturnValue(
      applicationLogQueryBuilder,
    );
    applicationLogQueryBuilder.getRawMany.mockResolvedValue([]);
    dataAccessLogService.recordDataAccess.mockResolvedValue(undefined);
  });

  it('returns direct profile trigger evidence without journal consent', async () => {
    const result = await service.loadForUser({
      userId: 'user-1',
      product: {
        id: 'checked-product',
        brand: 'Ritora Lab',
        name: 'Barrier Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Niacinamide'],
      },
      activeConsentTypes: new Set(),
      inventoryProducts: [],
      reactionTriggerIngredients: ['Niacinamide'],
    });

    expect(result).toEqual([
      {
        kind: ProductCheckEvidenceKind.ProfileReactionTrigger,
        confidence: AnalysisConfidence.High,
        productName: null,
        ingredientNames: ['Niacinamide'],
        reactionSignalCount: 0,
        usageDaysLast90: null,
      },
    ]);
    expect(
      applicationLogItemRepository.createQueryBuilder,
    ).not.toHaveBeenCalled();
  });

  it('surfaces reaction evidence when a matching shelf product has reaction signals near logged use', async () => {
    journalRepository.find.mockResolvedValue([
      {
        id: 'journal-1',
        entry_date: '2026-05-12',
        has_reaction_signal: true,
      },
    ]);
    applicationLogQueryBuilder.getRawMany.mockResolvedValue([
      { productId: 'shelf-1', targetDate: '2026-05-10' },
    ]);

    const result = await service.loadForUser({
      userId: 'user-1',
      product: {
        id: 'checked-product',
        brand: 'Ritora Lab',
        name: 'Barrier Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Aqua', 'Niacinamide'],
      },
      activeConsentTypes: new Set([UserConsentType.SkinProgressProcessing]),
      inventoryProducts: [
        {
          id: 'shelf-1',
          brand: 'Ritora Lab',
          name: 'Barrier Serum',
          category: ProductCategory.Serum,
          status: ShelfStatus.Active,
          identity: {
            brand: 'Ritora Lab',
            name: 'Barrier Serum',
            category: ProductCategory.Serum,
            inciIngredients: ['Aqua', 'Niacinamide'],
          },
        },
      ] as never,
      reactionTriggerIngredients: [],
    });

    expect(applicationLogQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('item.status = :appliedStatus'),
      expect.objectContaining({
        appliedStatus: ApplicationItemStatus.Applied,
        substitutedStatus: ApplicationItemStatus.Substituted,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        kind: ProductCheckEvidenceKind.ShelfReactionSignal,
        productName: 'Ritora Lab Barrier Serum',
        ingredientNames: ['Aqua', 'Niacinamide'],
        reactionSignalCount: 1,
        usageDaysLast90: 1,
      }),
    ]);
    expect(dataAccessLogService.recordDataAccess).toHaveBeenCalledWith(
      'user-1',
      [UserConsentType.SkinProgressProcessing],
      UserDataAccessPurpose.RecommendationAnalysis,
    );
  });
});
