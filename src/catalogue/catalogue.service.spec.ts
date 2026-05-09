import { BadRequestException } from '@nestjs/common';
import { CatalogueService } from './catalogue.service';
import {
  createCatalogueServiceTestHarness,
  createUploadedImage,
} from './catalogue.service.spec-utils';
import {
  CatalogueSource,
  LookupConfidence,
  LookupWarningCode,
  ProductCategory,
} from '../shelf/shelf.types';

type Harness = ReturnType<typeof createCatalogueServiceTestHarness>;

describe('CatalogueService', () => {
  let harness: Harness;
  let service: CatalogueService;
  let officialPageProvider: Harness['officialPageProvider'];
  let openAiExtractorProvider: Harness['openAiExtractorProvider'];
  let cataloguePhotoProcessorService: Harness['cataloguePhotoProcessorService'];
  let catalogueSourceRuleService: Harness['catalogueSourceRuleService'];
  let cataloguePhotoStorageService: Harness['cataloguePhotoStorageService'];

  beforeEach(() => {
    harness = createCatalogueServiceTestHarness();
    service = harness.service;
    officialPageProvider = harness.officialPageProvider;
    openAiExtractorProvider = harness.openAiExtractorProvider;
    cataloguePhotoProcessorService = harness.cataloguePhotoProcessorService;
    catalogueSourceRuleService = harness.catalogueSourceRuleService;
    cataloguePhotoStorageService = harness.cataloguePhotoStorageService;
  });

  it('extracts product metadata from multiple photos without persisting a draft image', async () => {
    const heroImage = createUploadedImage('heroImage');
    const ingredientImage = createUploadedImage('ingredientImage');
    const directionsImage = createUploadedImage('directionsImage');

    openAiExtractorProvider.extractFromImages.mockResolvedValue({
      data: {
        identity: {
          brand: 'CeraVe',
          name: 'Resurfacing Retinol Serum',
          category: ProductCategory.Serum,
          sizeMl: 30,
          description: 'A resurfacing serum for smoother-looking skin.',
          benefits: ['smoother texture'],
          suitedFor: ['sensitive skin'],
          imageUrls: ['https://example.com/draft-only-photo.webp'],
          inciIngredients: ['Aqua', 'Glycerin'],
        },
        guidance: {
          steps: ['Apply at night after cleansing.'],
          cautions: ['Use sunscreen during the day.'],
        },
        manufacturer: {
          productUrl: 'https://example.com/resurfacing-retinol-serum',
          websiteUrl: 'https://example.com',
        },
      },
      warnings: [
        LookupWarningCode.AiNormalized,
        LookupWarningCode.GuidanceUnverified,
        LookupWarningCode.IngredientsUnverified,
      ],
      evidence: [],
    });
    officialPageProvider.extract.mockResolvedValue({
      identity: {
        brand: 'CeraVe',
        name: 'Resurfacing Retinol Serum',
        category: ProductCategory.Serum,
        sizeMl: 30,
        description: 'Official description',
        benefits: ['official benefit'],
        suitedFor: ['official skin'],
        inciIngredients: ['Official Ingredient'],
      },
      guidance: {
        cautions: ['Avoid contact with eyes.'],
      },
      manufacturer: {
        brand: 'CeraVe',
        parentCompany: "L'Oréal",
        countryOfManufacture: 'FR',
        supportEmail: 'support@example.com',
        productUrl: 'https://example.com/resurfacing-retinol-serum',
        websiteUrl: 'https://example.com',
      },
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/resurfacing-retinol-serum',
          title: 'Resurfacing Retinol Serum',
        },
      ],
      rawSource: {},
      textExcerpt: 'Official product page excerpt',
    });
    openAiExtractorProvider.extract.mockResolvedValue(null);

    const result = await service.extractFromImages(
      [heroImage, ingredientImage, directionsImage],
      2,
    );

    expect(openAiExtractorProvider.extractFromImages).toHaveBeenCalledWith({
      images: [
        {
          buffer: heroImage.buffer,
          mimetype: 'image/jpeg',
        },
        {
          buffer: ingredientImage.buffer,
          mimetype: 'image/jpeg',
        },
        {
          buffer: directionsImage.buffer,
          mimetype: 'image/jpeg',
        },
      ],
      heroImageIndex: 2,
    });
    expect(
      cataloguePhotoProcessorService.prepareForExtraction,
    ).toHaveBeenCalledWith([heroImage, ingredientImage, directionsImage], 2);
    expect(
      cataloguePhotoStorageService.startHeroImageUpload,
    ).not.toHaveBeenCalled();
    expect(officialPageProvider.extract).toHaveBeenCalledWith(
      'https://example.com/resurfacing-retinol-serum',
    );
    expect(result?.provenance).toBe('photo-lookup');
    expect(result?.source).toBe(CatalogueSource.UserPhotos);
    expect(result?.identity.imageUrls).toBeUndefined();
    expect(result?.identity.description).toBe(
      'A resurfacing serum for smoother-looking skin.',
    );
    expect(result?.identity.inciIngredients).toEqual(['Aqua', 'Glycerin']);
    expect(result?.manufacturer.parentCompany).toBe("L'Oréal");
    expect(result?.manufacturer.supportEmail).toBe('support@example.com');
    expect(result?.manufacturer.productUrl).toBe(
      'https://example.com/resurfacing-retinol-serum',
    );
    expect(result?.confidence).toBe(LookupConfidence.Medium);
  });

  it('uses ai-normalized official page fields to fill missing photo fields without overwriting photo ingredients', async () => {
    const heroImage = createUploadedImage('heroImage');
    const labelImage = createUploadedImage('labelImage');

    openAiExtractorProvider.extractFromImages.mockResolvedValue({
      data: {
        identity: {
          brand: 'CeraVe',
          name: 'SA Smoothing Cleanser',
          category: ProductCategory.Cleanser,
          inciIngredients: [
            'Aqua / Water',
            'Sodium Lauroyl Sarcosinate',
            'Cocamidopropyl Hydroxysultaine',
          ],
        },
        guidance: {},
        manufacturer: {
          productUrl: 'https://example.com/sa-smoothing-cleanser',
          websiteUrl: 'https://example.com',
        },
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [],
    });
    officialPageProvider.extract.mockResolvedValue({
      identity: {
        brand: 'CeraVe',
        name: 'SA Smoothing Cleanser',
        category: ProductCategory.Cleanser,
        description:
          'Product Features & Benefits Salicylic Acid Helps exfoliate and soften. View Product.',
        benefits: ['Fragrance-free', 'View Product'],
        suitedFor: ['Sensitive skin'],
        inciIngredients: ['Noisy ingredient block'],
      },
      guidance: {
        steps: ['Massage cleanser onto wet skin', 'View Product'],
        cautions: ['Avoid direct contact with the eyes'],
      },
      manufacturer: {
        brand: 'CeraVe',
        productUrl: 'https://example.com/sa-smoothing-cleanser',
        websiteUrl: 'https://example.com',
      },
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/sa-smoothing-cleanser',
          title: 'SA Smoothing Cleanser',
        },
      ],
      rawSource: {},
      textExcerpt:
        'Noisy product page excerpt with ingredients, claims, footer links, and retailer cards.',
    });
    openAiExtractorProvider.extract.mockResolvedValue({
      data: {
        identity: {
          description: 'A salicylic acid cleanser that smooths rough skin.',
          benefits: ['gently exfoliates', 'smooths texture'],
          suitedFor: ['rough skin', 'sensitive skin'],
          inciIngredients: [
            'Aqua / Water',
            'Sodium Lauroyl Sarcosinate',
            'Cocamidopropyl Hydroxysultaine',
            'Glycerin',
            'Niacinamide',
            'Salicylic Acid',
          ],
        },
        guidance: {
          steps: ['Massage onto wet skin', 'Rinse thoroughly'],
          cautions: ['Avoid direct contact with eyes'],
        },
        manufacturer: {
          supportEmail: 'support@example.com',
          countryOfOrigin: 'US',
          countryOfManufacture: 'FR',
          parentCompany: "L'Oréal",
          productUrl: 'https://example.com/sa-smoothing-cleanser',
          websiteUrl: 'https://example.com',
        },
      },
      warnings: [
        LookupWarningCode.AiNormalized,
        LookupWarningCode.GuidanceUnverified,
        LookupWarningCode.IngredientsUnverified,
      ],
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/sa-smoothing-cleanser',
          title: 'SA Smoothing Cleanser',
        },
      ],
    });

    const result = await service.extractFromImages([heroImage, labelImage], 0);

    expect(result?.identity.description).toBe(
      'A salicylic acid cleanser that smooths rough skin.',
    );
    expect(result?.identity.benefits).toEqual([
      'gently exfoliates',
      'smooths texture',
    ]);
    expect(result?.identity.suitedFor).toEqual([
      'rough skin',
      'sensitive skin',
    ]);
    expect(result?.identity.inciIngredients).toEqual([
      'Aqua / Water',
      'Sodium Lauroyl Sarcosinate',
      'Cocamidopropyl Hydroxysultaine',
    ]);
    expect(result?.guidance.cautions).toEqual([
      'Avoid direct contact with eyes',
    ]);
    expect(result?.manufacturer.supportEmail).toBe('support@example.com');
    expect(result?.manufacturer.parentCompany).toBe("L'Oréal");
    expect(result?.manufacturer.countryOfOrigin).toBe('US');
    expect(result?.manufacturer.countryOfManufacture).toBe('FR');
  });

  it('returns a partial but usable photo lookup when only the product photo yields core identity details', async () => {
    const heroImage = createUploadedImage('heroImage');
    const labelImage = createUploadedImage('labelImage');

    openAiExtractorProvider.extractFromImages.mockResolvedValue({
      data: {
        identity: {
          brand: 'Beauty of Joseon',
          name: 'Relief Sun',
          category: ProductCategory.SunProtection,
          sizeMl: 50,
        },
        guidance: {},
        manufacturer: {},
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [],
    });

    const result = await service.extractFromImages([heroImage, labelImage], 0);

    expect(officialPageProvider.extract).not.toHaveBeenCalled();
    expect(result?.identity.brand).toBe('Beauty of Joseon');
    expect(result?.identity.name).toBe('Relief Sun');
    expect(result?.identity.inciIngredients).toBeUndefined();
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        LookupWarningCode.ReviewRequired,
        LookupWarningCode.PartialData,
      ]),
    );
    expect(result?.confidence).toBe(LookupConfidence.Medium);
  });

  it('strips blocked official-page urls and evidence from photo lookups', async () => {
    const heroImage = createUploadedImage('heroImage');
    const labelImage = createUploadedImage('labelImage');

    openAiExtractorProvider.extractFromImages.mockResolvedValue({
      data: {
        identity: {
          brand: 'CeraVe',
          name: 'Foaming Cleanser',
          category: ProductCategory.Cleanser,
        },
        guidance: {},
        manufacturer: {
          productUrl: 'https://bad.example/product',
          websiteUrl: 'https://bad.example',
        },
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://bad.example/product',
          title: 'Foaming Cleanser',
        },
      ],
    });
    catalogueSourceRuleService.evaluateUrl.mockResolvedValue({
      blocked: true,
      scoreAdjustment: Number.NEGATIVE_INFINITY,
      matchedLabels: ['blocked'],
    });

    const result = await service.extractFromImages([heroImage, labelImage], 0);

    expect(result?.manufacturer.productUrl).toBeUndefined();
    expect(result?.manufacturer.websiteUrl).toBeUndefined();
    expect(result?.evidence).toEqual([]);
  });

  it('returns a usable photo lookup without uploading the product image', async () => {
    const heroImage = createUploadedImage('heroImage');
    const labelImage = createUploadedImage('labelImage');

    openAiExtractorProvider.extractFromImages.mockResolvedValue({
      data: {
        identity: {
          brand: 'Round Lab',
          name: 'Birch Juice Moisturizing Sunscreen',
          category: ProductCategory.SunProtection,
          sizeMl: 50,
        },
        guidance: {},
        manufacturer: {},
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [],
    });

    const result = await service.extractFromImages([heroImage, labelImage], 0);

    expect(result?.identity.imageUrls).toBeUndefined();
    expect(
      cataloguePhotoStorageService.startHeroImageUpload,
    ).not.toHaveBeenCalled();
    expect(result?.identity.brand).toBe('Round Lab');
    expect(result?.source).toBe(CatalogueSource.UserPhotos);
  });

  it('rejects photo extraction requests with fewer than two images', async () => {
    await expect(
      service.extractFromImages([createUploadedImage('heroImage')], 0),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects photo extraction requests with an invalid hero image index', async () => {
    await expect(
      service.extractFromImages(
        [createUploadedImage('heroImage'), createUploadedImage('labelImage')],
        3,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
