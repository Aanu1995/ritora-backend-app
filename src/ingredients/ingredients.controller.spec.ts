import type { Request } from 'express';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';

const mockIngredientsService = () => ({
  analyzeForUser: jest.fn(),
});

describe('IngredientsController', () => {
  let controller: IngredientsController;
  let ingredientsService: ReturnType<typeof mockIngredientsService>;

  beforeEach(() => {
    ingredientsService = mockIngredientsService();
    controller = new IngredientsController(
      ingredientsService as unknown as IngredientsService,
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
});
