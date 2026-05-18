import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductCategory } from '../../shelf/shelf.types';
import { ProductCheckSource } from '../product-check.types';
import {
  ProductCompareGoal,
  ProductCompareItemKind,
  ProductCompareProductsDto,
} from './compare-products.dto';

function validPayload(): ProductCompareProductsDto {
  return plainToInstance(ProductCompareProductsDto, {
    anchor: {
      kind: ProductCompareItemKind.CheckedProduct,
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'Ritora Lab',
        name: 'Barrier Serum',
        category: ProductCategory.Serum,
        inciIngredients: ['Aqua', 'Niacinamide'],
      },
    },
    candidates: [
      {
        kind: ProductCompareItemKind.ShelfProduct,
        productId: '01KCOMPAREPRODUCT000000001',
      },
    ],
    goal: ProductCompareGoal.NewProductDecision,
    language: 'en',
  });
}

describe('ProductCompareProductsDto', () => {
  it('accepts a checked product compared with a shelf product', async () => {
    const errors = await validate(validPayload());

    expect(errors).toEqual([]);
  });

  it('rejects invalid compare goals', async () => {
    const dto = plainToInstance(ProductCompareProductsDto, {
      ...validPayload(),
      goal: 'random_decision',
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'goal',
        }),
      ]),
    );
  });

  it('rejects compare requests without candidates', async () => {
    const dto = validPayload();
    dto.candidates = [];

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'candidates',
        }),
      ]),
    );
  });

  it('rejects compare requests with more than four total products', async () => {
    const dto = validPayload();
    dto.candidates = Array.from({ length: 4 }, (_, index) => ({
      kind: ProductCompareItemKind.ShelfProduct,
      productId: `01KCOMPAREPRODUCT00000000${index}`,
    }));

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'candidates',
        }),
      ]),
    );
  });

  it('rejects shelf compare items without a shelf product id', async () => {
    const dto = validPayload();
    dto.candidates = [
      {
        kind: ProductCompareItemKind.ShelfProduct,
      },
    ] as ProductCompareProductsDto['candidates'];

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'candidates',
        }),
      ]),
    );
  });

  it('rejects checked compare items without valid product input', async () => {
    const dto = validPayload();
    dto.anchor = {
      kind: ProductCompareItemKind.CheckedProduct,
      product: {
        source: ProductCheckSource.IngredientPaste,
        brand: 'Ritora Lab',
        name: ' ',
        category: ProductCategory.Serum,
        inciIngredients: ['Niacinamide'],
      },
    };

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'anchor',
        }),
      ]),
    );
  });

  it('rejects invalid item kinds', async () => {
    const dto = plainToInstance(ProductCompareProductsDto, {
      ...validPayload(),
      anchor: {
        kind: 'external_search',
        productId: '01KCOMPAREPRODUCT000000001',
      },
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'anchor',
        }),
      ]),
    );
  });
});
