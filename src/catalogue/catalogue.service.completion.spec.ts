import {
  CatalogueSource,
  LookupWarningCode,
  ProductCategory,
} from '../shelf/shelf.types';
import {
  createCatalogueServiceTestHarness,
  createUploadedImage,
} from './catalogue.service.spec-utils';

describe('CatalogueService completion behavior', () => {
  it('corrects SPF products that photo extraction labels as moisturizer', async () => {
    const { service, openAiExtractorProvider } =
      createCatalogueServiceTestHarness();
    const heroImage = createUploadedImage('heroImage');
    const labelImage = createUploadedImage('labelImage');

    openAiExtractorProvider.extractFromImages.mockResolvedValue({
      data: {
        identity: {
          brand: 'Eucerin',
          name: 'Oil Control Dry Touch Gel-Cream SPF 50+',
          category: ProductCategory.Moisturizer,
          sizeMl: 50,
          description: 'Very high sun protection with UVA and UVB coverage.',
          benefits: ['oil control'],
          suitedFor: ['blemish-prone skin'],
        },
        guidance: {
          steps: ['Apply before sun exposure.'],
          cautions: [],
        },
        manufacturer: {},
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [],
    });

    const result = await service.extractFromImages([heroImage, labelImage], 0);

    expect(result?.identity.category).toBe(ProductCategory.SunProtection);
    expect(result?.reviewRequired).toBe(true);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([LookupWarningCode.ReviewRequired]),
    );
  });

  it('uses web discovery to complete missing ingredient data when the label omits it', async () => {
    const { service, openAiExtractorProvider } =
      createCatalogueServiceTestHarness();
    const heroImage = createUploadedImage('heroImage');
    const labelImage = createUploadedImage('labelImage');

    openAiExtractorProvider.extractFromImages.mockResolvedValue({
      data: {
        identity: {
          brand: 'Eucerin',
          name: 'Oil Control Dry Touch Gel-Cream SPF 50+',
          category: ProductCategory.SunProtection,
          sizeMl: 50,
          description: 'Very high sun protection for oily skin.',
          benefits: ['oil control'],
          suitedFor: ['blemish-prone skin'],
          inciIngredients: [],
        },
        guidance: {
          steps: ['Apply before sun exposure.'],
          cautions: [],
        },
        manufacturer: {},
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [],
    });
    openAiExtractorProvider.completeMissingFields.mockResolvedValue({
      data: {
        identity: {
          inciIngredients: ['Aqua', 'Alcohol Denat.', 'Glycerin'],
        },
        guidance: {},
        manufacturer: {
          productUrl: 'https://example.com/eucerin-spf-50',
          websiteUrl: 'https://example.com',
        },
      },
      warnings: [
        LookupWarningCode.AiNormalized,
        LookupWarningCode.IngredientsUnverified,
      ],
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/eucerin-spf-50',
          title: 'Eucerin Oil Control SPF 50+',
        },
      ],
    });

    const result = await service.extractFromImages([heroImage, labelImage], 0);

    expect(openAiExtractorProvider.completeMissingFields).toHaveBeenCalled();
    expect(result?.identity.inciIngredients).toEqual([
      'Aqua',
      'Alcohol Denat.',
      'Glycerin',
    ]);
    expect(result?.identity.inciLastConfirmedAt).toEqual(expect.any(String));
    expect(result?.manufacturer.productUrl).toBe(
      'https://example.com/eucerin-spf-50',
    );
  });

  it('cleans official page benefits and suited-for values before filling missing photo fields', async () => {
    const { service, openAiExtractorProvider, officialPageProvider } =
      createCatalogueServiceTestHarness();
    const heroImage = createUploadedImage('heroImage');
    const labelImage = createUploadedImage('labelImage');

    openAiExtractorProvider.extractFromImages.mockResolvedValue({
      data: {
        identity: {
          brand: 'Q+A',
          name: 'Glycolic Acid Daily Toner',
          category: ProductCategory.Toner,
        },
        guidance: {},
        manufacturer: {
          productUrl: 'https://example.com/glycolic-acid-daily-toner',
          websiteUrl: 'https://example.com',
        },
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [],
    });
    officialPageProvider.extract.mockResolvedValue({
      identity: {
        brand: 'Q+A',
        name: 'Glycolic Acid Daily Toner',
        category: ProductCategory.Toner,
        benefits: [
          'How does it help? Anti-Ageing, Calming, Pore Minimising',
          'Brightening',
          'Skin Firming',
          'Hydrating',
          'View Product',
        ],
        suitedFor: [
          'Skin type? Oily, Stressed, Dry, Sensitive, Normal, Combination',
          'Hydrating',
        ],
      },
      guidance: {},
      manufacturer: {
        brand: 'Q+A',
        productUrl: 'https://example.com/glycolic-acid-daily-toner',
        websiteUrl: 'https://example.com',
      },
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/glycolic-acid-daily-toner',
          title: 'Glycolic Acid Daily Toner',
        },
      ],
      rawSource: {},
      textExcerpt: null,
    });
    openAiExtractorProvider.extract.mockResolvedValue(null);

    const result = await service.extractFromImages([heroImage, labelImage], 0);

    expect(result?.identity.benefits).toEqual([
      'anti-aging',
      'calming',
      'pore-minimizing',
      'brightening',
      'firming',
      'hydrating',
    ]);
    expect(result?.identity.suitedFor).toEqual([
      'oily skin',
      'stressed skin',
      'dry skin',
      'sensitive skin',
      'normal skin',
      'combination skin',
    ]);
  });
});
