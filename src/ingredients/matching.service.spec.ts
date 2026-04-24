import { ProductCategory } from '../shelf/shelf.types';
import { buildStubCatalog } from './__tests__/catalog-fixtures';
import { MatchingService } from './matching.service';

describe('MatchingService', () => {
  const catalog = buildStubCatalog();
  const service = new MatchingService(catalog);

  function createProduct(inciIngredients: string[]) {
    return {
      id: 'product-1',
      brand: 'Test',
      name: 'Product',
      category: ProductCategory.Serum,
      inciIngredients,
    };
  }

  it('matches exact normalized slugs', () => {
    const result = service.matchProduct(createProduct(['Retinol']));

    expect(result.matchedIngredients).toHaveLength(1);
    expect(result.matchedIngredients[0]).toMatchObject({
      normalizedSlug: 'retinol',
      confidence: 1,
      inferred: false,
    });
  });

  it('matches aliases and keeps parsed concentration', () => {
    const result = service.matchProduct(createProduct(['L-Ascorbic Acid 15%']));

    expect(result.matchedIngredients).toHaveLength(1);
    expect(result.matchedIngredients[0]).toMatchObject({
      normalizedSlug: 'l-ascorbic-acid',
      concentrationPct: 15,
      confidence: 0.9,
      inferred: false,
    });
    expect(result.matchedIngredients[0].ingredient.slug).toBe('ascorbic-acid');
  });

  it('falls back to category regex matching', () => {
    const result = service.matchProduct(createProduct(['Retinyl']));

    expect(result.matchedIngredients).toHaveLength(1);
    expect(result.matchedIngredients[0]).toMatchObject({
      confidence: 0.6,
      inferred: true,
    });
    expect(result.matchedIngredients[0].ingredient.slug).toBe(
      'retinyl-palmitate',
    );
  });

  it('tracks unresolved tokens', () => {
    const result = service.matchProduct(
      createProduct(['Water', 'Niacinamide']),
    );

    expect(result.matchedIngredients).toHaveLength(1);
    expect(result.unresolvedTokens).toEqual(['Water']);
    expect(result.totalTokens).toBe(2);
    expect(result.resolvedTokens).toBe(1);
  });
});
