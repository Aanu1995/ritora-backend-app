import { BadRequestException } from '@nestjs/common';
import { ProductCategory } from '../shelf/shelf.types';
import { assertValidInventoryDraft } from './inventory.validation';

function createValidDraft() {
  return {
    identity: {
      brand: 'CeraVe',
      name: 'Resurfacing Retinol Serum',
      category: ProductCategory.Serum,
      barcode: '1234567890123',
      imageUrls: ['https://images.example.com/product.jpg'],
      sizeMl: 30,
      description: 'A resurfacing serum.',
      benefits: ['smoothing'],
      suitedFor: ['sensitive'],
      inciIngredients: ['Aqua'],
      inciLastConfirmedAt: null,
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: ['Apply to clean skin'],
      cautions: [],
      waitMinutes: null,
    },
    manufacturer: {
      brand: 'CeraVe',
      parentCompany: null,
      countryOfOrigin: null,
      countryOfManufacture: null,
      supportEmail: 'support@example.com',
      productUrl: 'https://www.example.com/products/retinol-serum',
      websiteUrl: 'https://www.example.com',
    },
    userFields: {
      openedAt: null,
      expiresAt: null,
      periodAfterOpeningMonths: null,
      pricePaid: null,
      pricePaidCurrency: null,
      purchasedFrom: null,
      personalNotes: null,
      preferredTimeOfDay: null,
    },
    status: undefined,
    provenance: undefined,
  };
}

describe('assertValidInventoryDraft', () => {
  it('accepts safe external URLs', () => {
    expect(() => assertValidInventoryDraft(createValidDraft())).not.toThrow();
  });

  it('rejects private-network image URLs', () => {
    const draft = createValidDraft();
    draft.identity.imageUrls = ['http://127.0.0.1:3000/product.jpg'];

    expect(() => assertValidInventoryDraft(draft)).toThrow(BadRequestException);
  });

  it('accepts locally stored backend media URLs for product images', () => {
    const draft = createValidDraft();
    draft.identity.imageUrls = [
      'http://localhost:3001/media/catalogue-front-photos/front-photo.jpg',
    ];

    expect(() => assertValidInventoryDraft(draft)).not.toThrow();
  });

  it('accepts products whose ingredient list is not available yet', () => {
    const draft = createValidDraft();
    draft.identity.inciIngredients = [];
    draft.identity.inciLastConfirmedAt = null;

    expect(() => assertValidInventoryDraft(draft)).not.toThrow();
  });

  it('rejects oversized ingredient lists before they reach analysis', () => {
    const draft = createValidDraft();
    draft.identity.inciIngredients = Array.from(
      { length: 121 },
      (_, index) => `Ingredient ${index + 1}`,
    );

    expect(() => assertValidInventoryDraft(draft)).toThrow(BadRequestException);
  });

  it('rejects ingredient names that are too long for public analysis', () => {
    const draft = createValidDraft();
    draft.identity.inciIngredients = ['A'.repeat(201)];

    expect(() => assertValidInventoryDraft(draft)).toThrow(BadRequestException);
  });

  it('rejects manufacturer URLs with embedded credentials', () => {
    const draft = createValidDraft();
    draft.manufacturer.productUrl = 'https://user:pass@example.com/product';

    expect(() => assertValidInventoryDraft(draft)).toThrow(BadRequestException);
  });
});
