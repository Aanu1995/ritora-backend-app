import { ProductCategory } from '../shelf/shelf.types';
import {
  AnalysisConfidence,
  AnalysisSeverity,
  IngredientCategory,
  type ProductMatchResult,
} from './ingredients.types';
import { resolveProductCheckConfidence } from './product-check-confidence';

function match(overrides: Partial<ProductMatchResult>): ProductMatchResult {
  return {
    product: {
      id: 'checked-product',
      brand: 'Ritora Lab',
      name: 'Test product',
      category: ProductCategory.Moisturizer,
      inciIngredients: [],
    },
    matchedIngredients: [],
    unresolvedTokens: [],
    totalTokens: 0,
    resolvedTokens: 0,
    ...overrides,
  };
}

function matchedIngredient(slug: string, confidence = 1) {
  return {
    ingredient: {
      slug,
      displayNameEn: slug,
      category: IngredientCategory.Humectant,
      aliases: [],
      categoryPatterns: [],
      summaryEn: '',
      overlapSeverity: AnalysisSeverity.Low,
    },
    rawToken: slug,
    normalizedSlug: slug,
    concentrationPct: null,
    confidence,
    inferred: confidence < 0.9,
  };
}

describe('resolveProductCheckConfidence', () => {
  it('returns low only when Quick Check has no usable ingredient matches', () => {
    expect(
      resolveProductCheckConfidence(
        match({
          totalTokens: 18,
          resolvedTokens: 0,
          unresolvedTokens: ['Aqua'],
        }),
      ),
    ).toBe(AnalysisConfidence.Low);
  });

  it('does not mark a complete INCI list low just because many base ingredients are unresolved', () => {
    expect(
      resolveProductCheckConfidence(
        match({
          totalTokens: 25,
          resolvedTokens: 1,
          matchedIngredients: [matchedIngredient('glycerin')],
        }),
      ),
    ).toBe(AnalysisConfidence.Medium);
  });

  it('returns high when a complete INCI list has several meaningful matches', () => {
    expect(
      resolveProductCheckConfidence(
        match({
          totalTokens: 25,
          resolvedTokens: 3,
          matchedIngredients: [
            matchedIngredient('glycerin'),
            matchedIngredient('ceramide-np'),
            matchedIngredient('sodium-hyaluronate'),
          ],
        }),
      ),
    ).toBe(AnalysisConfidence.High);
  });

  it('does not inflate confidence when matches are mostly weak/inferred', () => {
    expect(
      resolveProductCheckConfidence(
        match({
          totalTokens: 18,
          resolvedTokens: 4,
          matchedIngredients: [
            matchedIngredient('glycerin', 1),
            matchedIngredient('plant-extract', 0.72),
            matchedIngredient('fruit-acid', 0.7),
            matchedIngredient('botanical-blend', 0.68),
          ],
        }),
      ),
    ).toBe(AnalysisConfidence.Medium);
  });

  it('keeps confidence low when only weak inferred matches support the check', () => {
    expect(
      resolveProductCheckConfidence(
        match({
          totalTokens: 12,
          resolvedTokens: 1,
          matchedIngredients: [matchedIngredient('botanical-blend', 0.6)],
        }),
      ),
    ).toBe(AnalysisConfidence.Low);
  });

  it('keeps confidence low when resolved token counts are inconsistent with missing matches', () => {
    expect(
      resolveProductCheckConfidence(
        match({
          totalTokens: 12,
          resolvedTokens: 2,
          matchedIngredients: [],
        }),
      ),
    ).toBe(AnalysisConfidence.Low);
  });

  it('keeps a short fully matched ingredient check high', () => {
    expect(
      resolveProductCheckConfidence(
        match({
          totalTokens: 1,
          resolvedTokens: 1,
          matchedIngredients: [matchedIngredient('niacinamide')],
        }),
      ),
    ).toBe(AnalysisConfidence.High);
  });
});
