import { DataSource } from 'typeorm';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { ProductCategory } from '../shelf/shelf.types';
import { AnalysisService } from './analysis.service';
import type { ExplanationPort } from './explanation.port';
import {
  type IngredientClassification,
  type IngredientClassifierPort,
} from './ingredient-classifier.port';
import { IngredientIntelligenceService } from './ingredient-intelligence.service';
import {
  AnalysisSeverity,
  IngredientCategory,
  type ProductForAnalysis,
} from './ingredients.types';
import { TranslationService } from './translation.service';

function createService() {
  const classifier: IngredientClassifierPort = {
    classify: jest.fn(async ({ tokens }) =>
      tokens
        .map((token) => testClassification(token))
        .filter(
          (classification): classification is IngredientClassification =>
            classification !== null,
        ),
    ),
  };
  const intelligence = new IngredientIntelligenceService(classifier);
  const explanationProvider: ExplanationPort = {
    explainFindings: jest.fn(async () => null),
  };
  const translationService = new TranslationService(
    { get: () => '' } as never,
    {} as DataSource,
  );
  jest
    .spyOn(translationService, 'translate')
    .mockImplementation(async (text: string) => text);
  jest
    .spyOn(translationService, 'translateMany')
    .mockImplementation(async (texts: string[]) => [...texts]);
  return new AnalysisService(
    intelligence,
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

function testClassification(token: string): IngredientClassification | null {
  const normalized = token.toLowerCase();
  const base = {
    rawToken: token,
    canonicalName: token,
    confidence: 0.8,
    summaryEn: `${token} classified for test analysis.`,
    phSensitive: false,
    photosensitizing: false,
    requiresSpf: false,
    irritationRisk: false,
    overlapSeverity: AnalysisSeverity.Low,
  };

  if (normalized === 'retinol') {
    return {
      ...base,
      category: IngredientCategory.Retinoid,
      photosensitizing: true,
      requiresSpf: true,
      irritationRisk: true,
      overlapSeverity: AnalysisSeverity.High,
    };
  }
  if (normalized === 'retinaldehyde') {
    return {
      ...base,
      category: IngredientCategory.Retinoid,
      photosensitizing: true,
      requiresSpf: true,
      irritationRisk: true,
      overlapSeverity: AnalysisSeverity.High,
    };
  }
  if (normalized === 'glycolic acid') {
    return {
      ...base,
      category: IngredientCategory.Aha,
      photosensitizing: true,
      requiresSpf: true,
      irritationRisk: true,
      overlapSeverity: AnalysisSeverity.High,
    };
  }
  if (normalized === 'salicylic acid') {
    return {
      ...base,
      category: IngredientCategory.Bha,
      irritationRisk: true,
      overlapSeverity: AnalysisSeverity.High,
    };
  }
  if (normalized === 'l-ascorbic acid') {
    return {
      ...base,
      canonicalName: 'Vitamin C',
      category: IngredientCategory.VitaminC,
      phSensitive: true,
      overlapSeverity: AnalysisSeverity.Medium,
    };
  }
  if (normalized === 'ascorbyl glucoside') {
    return {
      ...base,
      category: IngredientCategory.VitaminC,
    };
  }
  if (normalized === 'niacinamide') {
    return {
      ...base,
      category: IngredientCategory.Niacinamide,
    };
  }
  if (normalized === 'benzoyl peroxide') {
    return {
      ...base,
      category: IngredientCategory.BenzoylPeroxide,
      irritationRisk: true,
      overlapSeverity: AnalysisSeverity.High,
    };
  }

  return null;
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
            ingredientB: 'Glycolic Acid',
          }),
        ]),
      );
    });

    it('does not require a seeded ingredient catalogue to detect category conflicts', async () => {
      const result = await service.analyze({
        products: [
          createProduct('retinol', 'Retinol Serum', ['Retinol']),
          createProduct('glycolic', 'Glycolic Toner', ['Glycolic Acid']),
        ],
        skinProfile: null,
        language: 'en',
        withExplanations: false,
      });

      expect(result.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'RETINOID_AHA',
            severity: 'high',
          }),
        ]),
      );
      expect(result.productsMissingInci).toEqual([]);
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
            ingredient: 'Salicylic Acid',
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
        products: [
          createProduct('version-product', 'Version Product', ['Retinol']),
        ],
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
            avoidIngredients: [],
          }),
        ]),
      );
    });

    it('returns insufficient data when the focus product has no inci list', async () => {
      const result = await service.analyze({
        products: [createProduct('focus', 'Mystery', [])],
        focusProductId: 'focus',
        skinProfile: Object.assign(new SkinProfile(), {
          skin_type: null,
          reaction_history: {},
        }),
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
