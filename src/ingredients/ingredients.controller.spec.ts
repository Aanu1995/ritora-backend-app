import type { Request } from 'express';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { ProductCheckService } from './product-check.service';
import { ProductCheckSource } from './product-check.types';
import { ProductCategory } from '../shelf/shelf.types';

const mockIngredientsService = () => ({
  analyzeForUser: jest.fn(),
});

const mockProductCheckService = () => ({
  checkForUser: jest.fn(),
});

describe('IngredientsController', () => {
  let controller: IngredientsController;
  let ingredientsService: ReturnType<typeof mockIngredientsService>;
  let productCheckService: ReturnType<typeof mockProductCheckService>;

  beforeEach(() => {
    ingredientsService = mockIngredientsService();
    productCheckService = mockProductCheckService();
    controller = new IngredientsController(
      ingredientsService as unknown as IngredientsService,
      productCheckService as unknown as ProductCheckService,
    );
  });

  it('uses an explicit DTO language when present', async () => {
    const result = { actives: [] };
    ingredientsService.analyzeForUser.mockResolvedValue(result);

    await expect(
      controller.analyze(
        'user-1',
        { headers: { 'accept-language': 'en' } } as Request,
        {
          focusProductId: 'product-1',
          withExplanations: false,
          language: 'sv',
        },
      ),
    ).resolves.toBe(result);

    expect(ingredientsService.analyzeForUser).toHaveBeenCalledWith(
      'user-1',
      {
        focusProductId: 'product-1',
        withExplanations: false,
        language: 'sv',
      },
      'sv',
    );
  });

  it('falls back to request language when the DTO does not include one', async () => {
    const result = { conflicts: [] };
    ingredientsService.analyzeForUser.mockResolvedValue(result);

    await expect(
      controller.analyze(
        'user-1',
        { headers: { 'accept-language': 'sv-SE,sv;q=0.9' } } as Request,
        {
          productIds: ['product-1', 'product-2'],
          withExplanations: false,
        },
      ),
    ).resolves.toBe(result);

    expect(ingredientsService.analyzeForUser).toHaveBeenCalledWith(
      'user-1',
      {
        productIds: ['product-1', 'product-2'],
        withExplanations: false,
      },
      'sv',
    );
  });

  it('checks an unsaved product using request language fallback', async () => {
    const result = { verdict: { label: 'good_fit' } };
    productCheckService.checkForUser.mockResolvedValue(result);
    const dto = {
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'Ritora Lab',
        name: 'Barrier Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Niacinamide'],
      },
    };

    await expect(
      controller.checkProduct(
        'user-1',
        { headers: { 'accept-language': 'sv-SE,sv;q=0.9' } } as Request,
        dto,
      ),
    ).resolves.toBe(result);

    expect(productCheckService.checkForUser).toHaveBeenCalledWith(
      'user-1',
      dto,
      'sv',
    );
  });
});
