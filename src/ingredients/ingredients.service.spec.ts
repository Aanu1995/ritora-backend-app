import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../shelf/shelf.types';
import { AnalysisService } from './analysis.service';
import { IngredientProductAnalysisSnapshotService } from './ingredient-product-analysis-snapshot.service';
import { IngredientsService } from './ingredients.service';
import { SkinProfileAnalysisContextService } from './skin-profile-analysis-context.service';

function product(id: string): InventoryProduct {
  return Object.assign(new InventoryProduct(), {
    id,
    user_id: 'user-1',
    brand: 'Ritora Lab',
    name: `Product ${id}`,
    category: ProductCategory.Serum,
    identity: { inciIngredients: ['Niacinamide'] },
  });
}

describe('IngredientsService', () => {
  const inventoryRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const analysisService = {
    analyze: jest.fn(),
  };
  const analysisContext = {
    loadForUser: jest.fn(),
  };
  const productAnalysisSnapshots = {
    analyzeFocusProductForUser: jest.fn(),
  };
  let service: IngredientsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IngredientsService(
      inventoryRepository as never,
      analysisService as unknown as AnalysisService,
      analysisContext as unknown as SkinProfileAnalysisContextService,
      productAnalysisSnapshots as unknown as IngredientProductAnalysisSnapshotService,
    );
    analysisService.analyze.mockResolvedValue({ status: 'ok' });
    analysisContext.loadForUser.mockResolvedValue(null);
    productAnalysisSnapshots.analyzeFocusProductForUser.mockResolvedValue({
      status: 'ok',
    });
  });

  it('rejects ambiguous analyze requests before touching user data', async () => {
    await expect(
      service.analyzeForUser(
        'user-1',
        {
          focusProductId: 'product-1',
          productIds: ['product-2'],
          withExplanations: false,
        },
        'en',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.analyzeForUser(
        'user-1',
        { productIds: [], withExplanations: false },
        'en',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(analysisContext.loadForUser).not.toHaveBeenCalled();
  });

  it('delegates focus analysis to the persisted product snapshot path', async () => {
    await service.analyzeForUser(
      'user-1',
      { focusProductId: 'product-1', withExplanations: true },
      'sv',
    );

    expect(
      productAnalysisSnapshots.analyzeFocusProductForUser,
    ).toHaveBeenCalledWith('user-1', 'product-1', 'sv', true, {
      forceRefresh: false,
    });
    expect(inventoryRepository.findOne).not.toHaveBeenCalled();
    expect(analysisContext.loadForUser).not.toHaveBeenCalled();
    expect(analysisService.analyze).not.toHaveBeenCalled();
  });

  it('passes force-refresh requests to the product snapshot path', async () => {
    await service.analyzeForUser(
      'user-1',
      {
        focusProductId: 'product-1',
        withExplanations: false,
        forceRefresh: true,
      },
      'en',
    );

    expect(
      productAnalysisSnapshots.analyzeFocusProductForUser,
    ).toHaveBeenCalledWith('user-1', 'product-1', 'en', false, {
      forceRefresh: true,
    });
  });

  it('returns not found when the focus product does not belong to the user', async () => {
    productAnalysisSnapshots.analyzeFocusProductForUser.mockRejectedValue(
      new NotFoundException('Inventory product not found'),
    );

    await expect(
      service.analyzeForUser(
        'user-1',
        { focusProductId: 'other-product', withExplanations: false },
        'en',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deduplicates multi-product requests and rejects missing shelf products', async () => {
    inventoryRepository.find.mockResolvedValue([product('product-1')]);

    await expect(
      service.analyzeForUser(
        'user-1',
        {
          productIds: ['product-1', 'product-1', 'missing'],
          withExplanations: false,
        },
        'en',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(inventoryRepository.find).toHaveBeenCalledWith({
      where: {
        id: expect.objectContaining({ _type: 'in' }),
        user_id: 'user-1',
      },
    });
  });

  it('runs multi-product analysis for owned products and handles missing INCI safely', async () => {
    const first = product('product-1');
    const second = Object.assign(product('product-2'), { identity: null });
    inventoryRepository.find.mockResolvedValue([second, first]);

    await service.analyzeForUser(
      'user-1',
      { productIds: ['product-1', 'product-2'], withExplanations: false },
      'en',
    );

    expect(analysisService.analyze).toHaveBeenCalledWith({
      products: [
        expect.objectContaining({
          id: 'product-1',
          inciIngredients: ['Niacinamide'],
        }),
        expect.objectContaining({ id: 'product-2', inciIngredients: [] }),
      ],
      skinProfile: null,
      language: 'en',
      tracking: {
        source: 'shelf_analysis',
        userId: 'user-1',
      },
      withExplanations: false,
    });
  });
});
