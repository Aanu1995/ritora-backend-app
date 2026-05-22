import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductCategory, LookupConfidence } from '../../shelf/shelf.types';
import { CheckProductDto } from './check-product.dto';
import { ProductCheckSource } from '../product-check.types';

function validPayload(): CheckProductDto {
  return plainToInstance(CheckProductDto, {
    product: {
      source: ProductCheckSource.IngredientPaste,
      brand: 'Ritora Lab',
      name: 'Barrier Serum',
      category: ProductCategory.Serum,
      inciIngredients: ['Aqua', 'Niacinamide'],
      lookupConfidence: LookupConfidence.High,
      reviewRequired: false,
    },
    language: 'en',
  });
}

describe('CheckProductDto', () => {
  it('accepts a minimal product-check request', async () => {
    const errors = await validate(validPayload());

    expect(errors).toEqual([]);
  });

  it('rejects invalid product categories', async () => {
    const dto = validPayload();
    dto.product.category = 'not-a-category' as ProductCategory;

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'product',
        }),
      ]),
    );
  });

  it('rejects missing product brands for pasted ingredient checks', async () => {
    const dto = validPayload();
    dto.product.brand = ' ';

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'product',
        }),
      ]),
    );
  });

  it('rejects missing product names for pasted ingredient checks', async () => {
    const dto = validPayload();
    dto.product.name = ' ';

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'product',
        }),
      ]),
    );
  });

  it('accepts photo checks when extraction only found readable ingredients', async () => {
    const dto = plainToInstance(CheckProductDto, {
      product: {
        source: ProductCheckSource.PhotoExtraction,
        brand: null,
        name: null,
        category: ProductCategory.Other,
        inciIngredients: ['Aqua', 'Glycerin'],
        lookupConfidence: LookupConfidence.Low,
        reviewRequired: true,
      },
      language: 'en',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects empty ingredient lists', async () => {
    const dto = validPayload();
    dto.product.inciIngredients = [];

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'product',
        }),
      ]),
    );
  });

  it('rejects blank ingredient tokens', async () => {
    const dto = validPayload();
    dto.product.inciIngredients = [' '];

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'product',
        }),
      ]),
    );
  });

  it('rejects overly large ingredient lists', async () => {
    const dto = validPayload();
    dto.product.inciIngredients = Array.from(
      { length: 121 },
      (_, index) => `Ingredient ${index}`,
    );

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'product',
        }),
      ]),
    );
  });

  it('rejects overly long ingredient tokens', async () => {
    const dto = validPayload();
    dto.product.inciIngredients = ['A'.repeat(201)];

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'product',
        }),
      ]),
    );
  });
});
