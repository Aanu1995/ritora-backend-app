import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { ProductCategory } from '../shelf/shelf.types';
import { AnalysisService } from './analysis.service';
import type { ExplanationPort } from './explanation.port';
import { buildStubCatalog } from './__tests__/catalog-fixtures';
import { MatchingService } from './matching.service';
import type { ProductForAnalysis } from './ingredients.types';
import type { TranslationService } from './translation.service';

function createService() {
  const catalog = buildStubCatalog();
  const matching = new MatchingService(catalog);
  const explanationProvider: ExplanationPort = {
    explainFindings: jest.fn(async () => null),
  };
  const translationService = {
    translate: jest.fn(async (text: string) => text),
    translateMany: jest.fn(async (texts: string[]) => [...texts]),
  } as unknown as TranslationService;
  return new AnalysisService(
    matching,
    catalog,
    translationService,
    explanationProvider,
  );
}

function createProduct(
  id: string,
  name: string,
  inciIngredients: string[],
  category = ProductCategory.Serum,
): ProductForAnalysis {
  return {
    id,
    brand: 'Test Brand',
    name,
    category,
    inciIngredients,
  };
}

describe('AnalysisService', () => {
  const service = createService();

  describe('multi-product mode', () => {
    it('flags retinoid plus aha as a high-severity conflict', async () => {
      const result = await service.analyze({
        products: [
          createProduct('retinol', 'Retinol Serum', ['Retinol']),
          createProduct('glycolic', 'Glycolic Toner', ['Glycolic Acid']),
        ],
        skinProfile: null,
        language: 'en',
        withExplanations: false,
      });

      expect(result.mode).toBe('multi');
      expect(result.status).toBe('ok');
      expect(result.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'RETINOID_AHA',
            severity: 'high',
            ingredientA: 'Retinol',
            ingredientB: 'Glycolic acid',
          }),
        ]),
      );
    });

    it('flags benzoyl peroxide plus retinoid as high severity', async () => {
      const result = await service.analyze({
        products: [
          createProduct('retinoid', 'Retinoid', ['Retinaldehyde']),
          createProduct('bpo', 'Cleanser', ['Benzoyl Peroxide']),
        ],
        skinProfile: null,
        language: 'en',
        withExplanations: false,
      });

      expect(result.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'BENZOYL_PEROXIDE_RETINOID',
            severity: 'high',
          }),
        ]),
      );
    });

    it('treats duplicated salicylic acid as a high overlap', async () => {
      const result = await service.analyze({
        products: [
          createProduct('cleanser', 'Salicylic Cleanser', ['Salicylic Acid']),
          createProduct('toner', 'Salicylic Toner', ['Salicylic Acid']),
        ],
        skinProfile: null,
        language: 'en',
        withExplanations: false,
      });

      expect(result.overlaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ingredient: 'Salicylic acid',
            severity: 'high',
            productIds: ['cleanser', 'toner'],
          }),
        ]),
      );
    });

    it('suppresses vitamin c plus niacinamide when the vitamin c is buffered', async () => {
      const result = await service.analyze({
        products: [
          createProduct('vitc', 'Vitamin C Serum', ['Ascorbyl Glucoside']),
          createProduct('niacinamide', 'B3 Serum', ['Niacinamide']),
        ],
        skinProfile: null,
        language: 'en',
        withExplanations: false,
      });

      expect(result.conflicts).toHaveLength(0);
    });

    it('flags pure vitamin c plus niacinamide as medium severity', async () => {
      const result = await service.analyze({
        products: [
          createProduct('vitc', 'Vitamin C Serum', ['L-Ascorbic Acid']),
          createProduct('niacinamide', 'B3 Serum', ['Niacinamide']),
        ],
        skinProfile: null,
        language: 'en',
        withExplanations: false,
      });

      expect(result.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'VITAMIN_C_NIACINAMIDE',
            severity: 'medium',
          }),
        ]),
      );
    });

    it('reports engine version on every response', async () => {
      const result = await service.analyze({
        products: [createProduct('any', 'Any', ['Retinol'])],
        skinProfile: null,
        language: 'en',
        withExplanations: false,
      });

      expect(result.engineVersion).toBe('v2');
    });
  });

  describe('focus mode', () => {
    it('returns educational actives with pairing guidance', async () => {
      const result = await service.analyze({
        products: [createProduct('focus', 'My Serum', ['Retinol'])],
        focusProductId: 'focus',
        skinProfile: null,
        language: 'en',
        withExplanations: false,
      });

      expect(result.mode).toBe('focus');
      expect(result.status).toBe('ok');
      expect(result.conflicts).toEqual([]);
      expect(result.overlaps).toEqual([]);
      expect(result.actives).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            slug: 'retinol',
            displayName: 'Retinol',
            category: 'retinoid',
            avoidCategories: expect.arrayContaining(['aha', 'bha']),
            avoidIngredients: expect.arrayContaining([
              expect.objectContaining({
                slug: 'ascorbic-acid',
                displayName: 'Vitamin C',
              }),
            ]),
          }),
        ]),
      );
    });

    it('returns insufficient data when the focus product has no inci list', async () => {
      const result = await service.analyze({
        products: [createProduct('focus', 'Mystery', [])],
        focusProductId: 'focus',
        skinProfile: {
          skin_type: null,
          known_sensitivities: [],
        } as unknown as SkinProfile,
        language: 'en',
        withExplanations: false,
      });

      expect(result.mode).toBe('focus');
      expect(result.status).toBe('insufficient_data');
      expect(result.actives).toEqual([]);
      expect(result.productsMissingInci).toEqual(['focus']);
    });
  });
});
