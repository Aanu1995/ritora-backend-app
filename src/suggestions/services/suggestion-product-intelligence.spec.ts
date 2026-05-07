import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  ApplicationMethod,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfStatus,
} from '../../shelf/shelf.types';
import {
  assessProductDataQuality,
  scoreProductForSuggestion,
} from './suggestion-product-intelligence';

describe('suggestion product intelligence', () => {
  it('marks incomplete shelf data as insufficient and lowers suitability', () => {
    const product = productWithData({
      category: ProductCategory.Other,
      inciIngredients: [],
      inciLastConfirmedAt: null,
      preferredTimeOfDay: null,
    });

    const quality = assessProductDataQuality(product);
    const score = scoreProductForSuggestion(product, {
      daypart: 'morning',
      primaryGoal: 'barrier support',
      sensitivityLevel: 'high',
      recentUseCount: 0,
      hasReactionSignal: false,
      lockedProductIds: new Set(),
      conservativeRestart: false,
    });

    expect(quality).toEqual(
      expect.objectContaining({
        quality: 'insufficient',
        warnings: expect.arrayContaining([
          'ingredient list missing',
          'product category needs review',
        ]),
      }),
    );
    expect(score.dataQuality).toBe('insufficient');
    expect(score.suitabilityScore).toBeLessThan(55);
  });

  it('marks verified product intelligence when INCI, timing, and guidance are present', () => {
    const product = productWithData({
      category: ProductCategory.Serum,
      inciIngredients: ['Niacinamide', 'Glycerin'],
      inciLastConfirmedAt: '2026-05-01',
      preferredTimeOfDay: PreferredTimeOfDay.Either,
    });
    product.guidance = {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.PeaSize,
      steps: ['Apply after cleansing'],
      cautions: [],
      waitMinutes: 2,
    };

    expect(assessProductDataQuality(product).quality).toBe('verified');
  });

  it('does not warn when optional timing hints are missing', () => {
    const product = productWithData({
      category: ProductCategory.Moisturizer,
      inciIngredients: ['Glycerin', 'Ceramide NP'],
      inciLastConfirmedAt: '2026-05-01',
      preferredTimeOfDay: null,
    });
    product.guidance = {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.PeaSize,
      steps: ['Apply to clean skin'],
      cautions: [],
      waitMinutes: null,
    };

    expect(assessProductDataQuality(product)).toEqual({
      quality: 'verified',
      warnings: [],
    });
  });

  it('trusts matched ingredient intelligence even when source confirmation date is absent', () => {
    const product = productWithData({
      category: ProductCategory.Treatment,
      inciIngredients: ['Water', 'Azelaic Acid', 'Tocopherol'],
      inciLastConfirmedAt: null,
      preferredTimeOfDay: null,
    });
    product.guidance = {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.AsNeeded,
      steps: ['Apply a small amount'],
      cautions: ['Use sun protection'],
      waitMinutes: null,
    };

    expect(
      assessProductDataQuality(product, ['azelaic_acid'], {
        matchedIngredientCount: 2,
        totalIngredientCount: 3,
      }),
    ).toEqual({
      quality: 'verified',
      warnings: [],
    });
  });

  it('warns when an INCI list has no matched key actives', () => {
    const product = productWithData({
      category: ProductCategory.SunProtection,
      inciIngredients: ['UVA/UVB filter', 'Licochalcone A'],
      inciLastConfirmedAt: '2026-05-01',
      preferredTimeOfDay: null,
    });
    product.guidance = {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.AsNeeded,
      steps: ['Apply generously'],
      cautions: [],
      waitMinutes: null,
    };

    expect(
      assessProductDataQuality(product, ['spf'], {
        matchedIngredientCount: 0,
        totalIngredientCount: 2,
      }),
    ).toEqual(
      expect.objectContaining({
        quality: 'partial',
        warnings: ['key active ingredients not matched'],
      }),
    );
  });
});

function productWithData(input: {
  category: ProductCategory;
  inciIngredients: string[];
  inciLastConfirmedAt: string | null;
  preferredTimeOfDay: PreferredTimeOfDay | null;
}): InventoryProduct {
  return {
    id: 'product-1',
    user_id: 'user-1',
    brand: 'Ava Lab',
    name: 'Barrier Serum',
    category: input.category,
    status: ShelfStatus.Active,
    identity: {
      inciIngredients: input.inciIngredients,
      inciLastConfirmedAt: input.inciLastConfirmedAt,
      benefits: ['barrier support'],
      suitedFor: [],
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    user_fields: {
      preferredTimeOfDay: input.preferredTimeOfDay,
    },
  } as unknown as InventoryProduct;
}
