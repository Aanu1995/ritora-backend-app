import {
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
  LookupWarningCode,
  ProductCategory,
} from './shelf.types';
import {
  normalizeCatalogueIdentitySnapshot,
  normalizeCatalogueSuggestionPayload,
  normalizeManufacturerInfoSnapshot,
  normalizeResolvedLookupPayload,
} from './shelf-payload-normalizer';

describe('shelf payload normalizer', () => {
  it('normalizes lookup payloads to frontend-safe values', () => {
    const normalized = normalizeResolvedLookupPayload({
      identity: {
        brand: '  CeraVe&nbsp; ',
        name: '  Resurfacing <strong>Retinol</strong> Serum ',
        category: ProductCategory.Serum,
        imageUrls: [
          'https://example.com/image.png',
          'https://example.com/image.png',
          'javascript:alert(1)',
        ],
        sizeMl: 30,
        description:
          '  A renewing&nbsp;serum with <em>gentle</em> resurfacing. ',
        benefits: [' smoothing ', 'smoothing', 'calming&#39;s'],
        suitedFor: [' combination ', 'sensitive&nbsp;skin'],
        inciIngredients: [' Aqua ', 'Glycerin<br/>Niacinamide'],
      },
      guidance: {
        cautions: [' Use sunscreen&nbsp;during the day. '],
      },
      manufacturer: {
        parentCompany: ' L&#39;Oréal ',
        countryOfManufacture: 'France',
        supportEmail: ' support@example.com ',
        productUrl: 'https://example.com/product',
      },
      provenance: DataProvenance.PhotoLookup,
      source: CatalogueSource.OpenBeautyFacts,
      confidence: LookupConfidence.Medium,
      reviewRequired: true,
      warnings: [
        LookupWarningCode.ReviewRequired,
        LookupWarningCode.ReviewRequired,
      ],
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/product',
          title: ' Product page ',
        },
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/product',
          title: ' Product page ',
        },
      ],
    });

    expect(normalized.identity.imageUrls).toEqual([
      'https://example.com/image.png',
    ]);
    expect(normalized.identity.description).toBe(
      'A renewing serum with gentle resurfacing.',
    );
    expect(normalized.identity.benefits).toEqual(['smoothing', "calming's"]);
    expect(normalized.identity.suitedFor).toEqual([
      'combination',
      'sensitive skin',
    ]);
    expect(normalized.identity.inciIngredients).toEqual([
      'Aqua',
      'Glycerin Niacinamide',
    ]);
    expect(normalized.guidance.cautions).toEqual([
      'Use sunscreen during the day.',
    ]);
    expect(normalized.manufacturer.parentCompany).toBe("L'Oréal");
    expect(normalized.manufacturer.countryOfManufacture).toBe('FR');
    expect(normalized.manufacturer.supportEmail).toBe('support@example.com');
    expect(normalized.warnings).toEqual([LookupWarningCode.ReviewRequired]);
    expect(normalized.evidence).toEqual([
      {
        source: CatalogueSource.OfficialPage,
        url: 'https://example.com/product',
        title: 'Product page',
      },
    ]);
  });

  it('normalizes full snapshot payloads for inventory responses', () => {
    const identity = normalizeCatalogueIdentitySnapshot({
      brand: '  CeraVe&nbsp;',
      name: ' Moisturizing <span>Lotion</span> ',
      category: 'bad-category' as ProductCategory,
      barcode: ' 3337875684118 ',
      imageUrls: ['https://example.com/a.png', 'https://example.com/a.png'],
      sizeMl: 236,
      description: '  Daily&nbsp;moisturizer <br/> for dry skin ',
      benefits: [' hydrating ', 'hydra&nbsp;ting', ' hydrating '],
      suitedFor: [' dry ', ' sensitive &#x26; reactive '],
      inciIngredients: [' Aqua ', 'Glycerin'],
    });
    const manufacturer = normalizeManufacturerInfoSnapshot(
      {
        brand: '',
        countryOfOrigin: 'United States',
        countryOfManufacture: 'US',
        supportEmail: 'support@example.com',
        productUrl: 'https://example.com/product',
      },
      identity.brand,
    );
    const suggestion = normalizeCatalogueSuggestionPayload({
      id: 'suggestion-1',
      brand: '  CeraVe ',
      name: ' Moisturizing Lotion ',
      category: 'bad-category' as ProductCategory,
      imageUrls: ['https://example.com/a.png', 'https://example.com/a.png'],
      sizeMl: 236,
      barcode: ' 3337875684118 ',
      source: CatalogueSource.OpenBeautyFacts,
      confidence: LookupConfidence.Low,
      reviewRequired: true,
    });

    expect(identity.brand).toBe('CeraVe');
    expect(identity.category).toBe(ProductCategory.Other);
    expect(identity.imageUrls).toEqual(['https://example.com/a.png']);
    expect(manufacturer.brand).toBe('CeraVe');
    expect(manufacturer.countryOfOrigin).toBe('US');
    expect(suggestion.brand).toBe('CeraVe');
    expect(suggestion.category).toBe(ProductCategory.Other);
  });

  it('removes file-name artifacts from product names before returning them', () => {
    const normalized = normalizeResolvedLookupPayload({
      identity: {
        brand: 'The Ordinary',
        name: 'Azelaic Acid Suspension 10 Exfoliator 100407.html',
        category: ProductCategory.Treatment,
        imageUrls: [],
        sizeMl: null,
        description: null,
        benefits: [],
        suitedFor: [],
        inciIngredients: [],
        inciLastConfirmedAt: null,
      },
      guidance: {},
      manufacturer: {
        brand: 'The Ordinary',
      },
      provenance: DataProvenance.PhotoLookup,
      source: CatalogueSource.OfficialPage,
      confidence: LookupConfidence.Medium,
      reviewRequired: true,
      warnings: [],
      evidence: [],
    });

    expect(normalized.identity.name).toBe(
      'Azelaic Acid Suspension 10 Exfoliator',
    );
  });
});
