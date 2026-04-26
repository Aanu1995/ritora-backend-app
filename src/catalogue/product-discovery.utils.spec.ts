import { ProductCategory } from '../shelf/shelf.types';
import {
  inferCategoryFromText,
  refineCategoryFromText,
} from './product-discovery.utils';

describe('product-discovery category inference', () => {
  it('prioritizes SPF evidence over moisturizer texture words', () => {
    expect(
      inferCategoryFromText(
        'Eucerin Oil Control Dry Touch Gel-Cream SPF 50+ UVA UVB',
      ),
    ).toBe(ProductCategory.SunProtection);
  });

  it('overrides moisturizer when the product has strong sun-protection signals', () => {
    expect(
      refineCategoryFromText(
        ProductCategory.Moisturizer,
        'Dry Touch Gel-Cream',
        'Very high sun protection SPF 50+',
      ),
    ).toBe(ProductCategory.SunProtection);
  });

  it('does not turn ordinary SPF usage cautions into a category override', () => {
    expect(
      refineCategoryFromText(
        ProductCategory.Serum,
        'Resurfacing Retinol Serum',
        'A resurfacing serum for smoother-looking skin.',
      ),
    ).toBe(ProductCategory.Serum);
  });

  it('uses the strongest product-role signal across the full category set', () => {
    expect(
      refineCategoryFromText(
        ProductCategory.Moisturizer,
        'Gentle Cleansing Balm',
      ),
    ).toBe(ProductCategory.Cleanser);
    expect(
      refineCategoryFromText(ProductCategory.Serum, 'Hydrating Eye Serum'),
    ).toBe(ProductCategory.EyeCare);
    expect(
      refineCategoryFromText(ProductCategory.Serum, 'AHA BHA Peeling Solution'),
    ).toBe(ProductCategory.Exfoliant);
    expect(
      refineCategoryFromText(ProductCategory.Moisturizer, 'Lip Sleeping Mask'),
    ).toBe(ProductCategory.LipCare);
  });

  it('recognizes common non-English category cues', () => {
    expect(inferCategoryFromText('Solskydd SPF 50')).toBe(
      ProductCategory.SunProtection,
    );
    expect(inferCategoryFromText('Creme hydratante visage')).toBe(
      ProductCategory.Moisturizer,
    );
    expect(inferCategoryFromText('Limpiador facial')).toBe(
      ProductCategory.Cleanser,
    );
    expect(inferCategoryFromText('Contorno de ojos')).toBe(
      ProductCategory.EyeCare,
    );
  });
});
