import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogueService } from './catalogue.service';
import { CatalogueProduct } from './entities/catalogue-product.entity';
import { CataloguePhotoStorageService } from './catalogue-photo-storage.service';
import type { UploadedCatalogueImage } from './catalogue-photo.types';
import { OfficialPageProvider } from './official-page.provider';
import { OpenAiExtractorProvider } from './openai-extractor.provider';
import { OpenBeautyFactsProvider } from './open-beauty-facts.provider';
import { ProductPageDiscoveryProvider } from './product-page-discovery.provider';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
import {
  CatalogueSource,
  LookupConfidence,
  LookupWarningCode,
  ProductCategory,
} from '../shelf/shelf.types';

const createMockQueryBuilder = () => ({
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  setParameters: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getRawAndEntities: jest.fn(),
  getOne: jest.fn(),
});

const mockRepository = () => ({
  createQueryBuilder: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

function createProduct(id: string, name: string): CatalogueProduct {
  return {
    id,
    brand: 'CeraVe',
    name,
    category: ProductCategory.Serum,
    barcode: `barcode-${id}`,
    brand_search: 'cerave',
    name_search: name.toLowerCase(),
    identity: {
      brand: 'CeraVe',
      name,
      category: ProductCategory.Serum,
      barcode: `barcode-${id}`,
      imageUrls: [],
      sizeMl: 30,
      description: 'Retinol serum',
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
      supportEmail: null,
      productUrl: 'https://example.com/product',
      websiteUrl: 'https://example.com',
    },
    source_type: CatalogueSource.RitoraCatalogue,
    source_id: null,
    source_url: null,
    confidence: LookupConfidence.High,
    review_required: false,
    warnings: [],
    raw_source: {},
    last_synced_at: null,
    created_at: new Date('2026-04-18T00:00:00.000Z'),
    updated_at: new Date('2026-04-18T00:00:00.000Z'),
    generateId: jest.fn(),
  } as CatalogueProduct;
}

function createSparseProduct(id: string, name: string): CatalogueProduct {
  const product = createProduct(id, name);

  product.identity = {
    ...product.identity,
    description: null,
    benefits: [],
    suitedFor: [],
  };
  product.guidance = {
    ...product.guidance,
    cautions: [],
  };
  product.manufacturer = {
    ...product.manufacturer,
    parentCompany: null,
    countryOfOrigin: null,
    countryOfManufacture: null,
    supportEmail: null,
    productUrl: null,
    websiteUrl: null,
  };

  return product;
}

function createUploadedImage(name: string): UploadedCatalogueImage {
  return {
    originalname: `${name}.jpg`,
    mimetype: 'image/jpeg',
    size: name.length,
    buffer: Buffer.from(name),
  };
}

describe('CatalogueService', () => {
  let service: CatalogueService;
  let repo: jest.Mocked<Repository<CatalogueProduct>>;
  let queryBuilder: ReturnType<typeof createMockQueryBuilder>;
  const openBeautyFactsProvider = {
    resolveBarcode: jest.fn(),
  };
  const officialPageProvider = {
    extract: jest.fn(),
  };
  const openAiExtractorProvider = {
    extract: jest.fn(),
    extractFromImages: jest.fn(),
    completeMissingFields: jest.fn(),
  };
  const productPageDiscoveryProvider = {
    discover: jest.fn(),
  };
  const catalogueSourceRuleService = {
    evaluateUrl: jest.fn(),
  };
  const cataloguePhotoStorageService = {
    saveHeroImage: jest.fn(),
  };

  beforeEach(async () => {
    queryBuilder = createMockQueryBuilder();
    openBeautyFactsProvider.resolveBarcode.mockReset();
    officialPageProvider.extract.mockReset();
    openAiExtractorProvider.extract.mockReset();
    openAiExtractorProvider.extractFromImages.mockReset();
    openAiExtractorProvider.completeMissingFields.mockReset();
    productPageDiscoveryProvider.discover.mockReset();
    catalogueSourceRuleService.evaluateUrl.mockReset();
    cataloguePhotoStorageService.saveHeroImage.mockReset();
    productPageDiscoveryProvider.discover.mockResolvedValue([]);
    catalogueSourceRuleService.evaluateUrl.mockResolvedValue({
      blocked: false,
      scoreAdjustment: 0,
      matchedRuleId: null,
      labels: [],
    });
    cataloguePhotoStorageService.saveHeroImage.mockResolvedValue(
      'http://localhost:3001/media/catalogue-front-photos/front-photo.jpg',
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogueService,
        {
          provide: getRepositoryToken(CatalogueProduct),
          useFactory: mockRepository,
        },
        {
          provide: OpenBeautyFactsProvider,
          useValue: openBeautyFactsProvider,
        },
        {
          provide: OfficialPageProvider,
          useValue: officialPageProvider,
        },
        {
          provide: OpenAiExtractorProvider,
          useValue: openAiExtractorProvider,
        },
        {
          provide: ProductPageDiscoveryProvider,
          useValue: productPageDiscoveryProvider,
        },
        {
          provide: CatalogueSourceRuleService,
          useValue: catalogueSourceRuleService,
        },
        {
          provide: CataloguePhotoStorageService,
          useValue: cataloguePhotoStorageService,
        },
      ],
    }).compile();

    service = module.get<CatalogueService>(CatalogueService);
    repo = module.get(getRepositoryToken(CatalogueProduct));
    repo.createQueryBuilder.mockReturnValue(queryBuilder as never);
  });

  it('rejects unsafe private-network URLs during URL resolution', async () => {
    await expect(
      service.resolveUrl('http://127.0.0.1:3000/private-product'),
    ).rejects.toThrow(BadRequestException);
  });

  it('uses ai-normalized official page fields to clean noisy parsed output', async () => {
    queryBuilder.getOne.mockResolvedValue(null);
    repo.findOne.mockResolvedValue(null);
    repo.create.mockReturnValue({} as CatalogueProduct);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );
    officialPageProvider.extract.mockResolvedValue({
      identity: {
        brand: 'CeraVe',
        name: 'SA Smoothing Cleanser',
        category: ProductCategory.Cleanser,
        barcode: '3337875795456',
        description:
          'Product Features & Benefits Salicylic Acid Helps exfoliate and soften. View Product.',
        benefits: ['Fragrance-free', 'View Product'],
        suitedFor: ['Sensitive skin'],
        inciIngredients: [
          'Salicylic Acid',
          'Free of physical exfoliants',
          'Aqua / Water',
          'Sodium Lauroyl Sarcosinate',
          'Massage cleanser onto wet skin',
        ],
      },
      guidance: {
        steps: ['Massage cleanser onto wet skin', 'View Product'],
        cautions: ['Avoid direct contact with the eyes'],
      },
      manufacturer: {
        brand: 'CeraVe',
        productUrl: 'https://example.com/sa-smoothing-cleanser',
        websiteUrl: 'https://example.com',
        supportEmail: null,
        parentCompany: null,
        countryOfOrigin: null,
        countryOfManufacture: null,
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
          brand: 'CeraVe',
          name: 'SA Smoothing Cleanser',
          category: ProductCategory.Cleanser,
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
    openAiExtractorProvider.completeMissingFields.mockResolvedValue(null);

    const result = await service.resolveUrl(
      'https://example.com/sa-smoothing-cleanser',
    );

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
      'Glycerin',
      'Niacinamide',
      'Salicylic Acid',
    ]);
    expect(result?.guidance.steps).toEqual([
      'Massage onto wet skin',
      'Rinse thoroughly',
    ]);
    expect(result?.guidance.cautions).toEqual([
      'Avoid direct contact with eyes',
    ]);
    expect(result?.manufacturer.supportEmail).toBe('support@example.com');
    expect(result?.manufacturer.parentCompany).toBe("L'Oréal");
    expect(result?.manufacturer.countryOfOrigin).toBe('US');
    expect(result?.manufacturer.countryOfManufacture).toBe('FR');
  });

  it('extracts a product from multiple photos and persists the selected hero image', async () => {
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
      'http://localhost:3001',
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
    expect(cataloguePhotoStorageService.saveHeroImage).toHaveBeenCalledWith(
      directionsImage,
      'http://localhost:3001',
    );
    expect(productPageDiscoveryProvider.discover).not.toHaveBeenCalled();
    expect(officialPageProvider.extract).toHaveBeenCalledWith(
      'https://example.com/resurfacing-retinol-serum',
    );
    expect(result?.provenance).toBe('photo-lookup');
    expect(result?.source).toBe(CatalogueSource.UserPhotos);
    expect(result?.identity.imageUrls).toEqual([
      'http://localhost:3001/media/catalogue-front-photos/front-photo.jpg',
    ]);
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

    const result = await service.extractFromImages(
      [heroImage, labelImage],
      0,
      'http://localhost:3001',
    );

    expect(productPageDiscoveryProvider.discover).not.toHaveBeenCalled();
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

  it('rejects photo extraction requests with fewer than two images', async () => {
    await expect(
      service.extractFromImages([createUploadedImage('heroImage')], 0, 'http://localhost:3001'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects photo extraction requests with an invalid hero image index', async () => {
    await expect(
      service.extractFromImages(
        [createUploadedImage('heroImage'), createUploadedImage('labelImage')],
        3,
        'http://localhost:3001',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('falls back to AI discovery for barcode scans when open beauty facts has no match', async () => {
    queryBuilder.getOne.mockResolvedValue(null);
    repo.findOne.mockResolvedValue(null);
    repo.create.mockReturnValue({} as CatalogueProduct);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );
    openBeautyFactsProvider.resolveBarcode.mockResolvedValue(null);
    officialPageProvider.extract.mockResolvedValue(null);
    openAiExtractorProvider.completeMissingFields.mockResolvedValue({
      data: {
        identity: {
          brand: 'CeraVe',
          name: 'Resurfacing Retinol Serum',
          category: ProductCategory.Serum,
          description: 'A resurfacing serum for smoother-looking skin.',
          benefits: ['smoother texture'],
          suitedFor: ['sensitive'],
        },
        guidance: {
          cautions: ['Use sunscreen during the day.'],
        },
        manufacturer: {
          parentCompany: 'Loreal',
          countryOfManufacture: 'France',
          supportEmail: 'support@example.com',
          productUrl: 'https://example.com/product',
          websiteUrl: 'https://example.com',
        },
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/product',
          title: null,
        },
      ],
    });
    productPageDiscoveryProvider.discover.mockResolvedValue([]);

    const result = await service.resolveBarcode('3337875684118');

    expect(openAiExtractorProvider.completeMissingFields).toHaveBeenCalled();
    expect(result?.identity.brand).toBe('CeraVe');
    expect(result?.identity.name).toBe('Resurfacing Retinol Serum');
    expect(result?.manufacturer.productUrl).toBe('https://example.com/product');
    expect(result?.confidence).toBe(LookupConfidence.High);
  });

  it('skips slow AI barcode fallback for the scan endpoint when open beauty facts has no match', async () => {
    queryBuilder.getOne.mockResolvedValue(null);
    repo.findOne.mockResolvedValue(null);
    openBeautyFactsProvider.resolveBarcode.mockResolvedValue(null);

    const result = await service.resolveBarcodeForScan('3337875684118');

    expect(openAiExtractorProvider.completeMissingFields).not.toHaveBeenCalled();
    expect(officialPageProvider.extract).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns open beauty facts barcode hits for the scan endpoint without official-page enrichment', async () => {
    queryBuilder.getOne.mockResolvedValue(null);
    repo.findOne.mockResolvedValue(null);
    repo.create.mockReturnValue({} as CatalogueProduct);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );
    openBeautyFactsProvider.resolveBarcode.mockResolvedValue({
      identity: {
        brand: 'The Ordinary',
        name: 'Azelaic Acid Suspension 10%',
        category: ProductCategory.Exfoliant,
        barcode: '769915195854',
        imageUrls: [],
        sizeMl: 30,
        description: null,
        benefits: [],
        suitedFor: [],
        inciIngredients: ['Aqua (Water)', 'Dimethicone', 'Azelaic Acid'],
        inciLastConfirmedAt: new Date('2026-04-20T00:00:00.000Z').toISOString(),
      },
      guidance: {},
      manufacturer: {
        brand: 'The Ordinary',
        productUrl:
          'https://theordinary.com/en-us/azelaic-acid-suspension-10-100407.html',
        websiteUrl: 'https://theordinary.com',
      },
      provenance: 'barcode-lookup',
      source: CatalogueSource.OpenBeautyFacts,
      confidence: LookupConfidence.Low,
      reviewRequired: true,
      warnings: [
        LookupWarningCode.ReviewRequired,
        LookupWarningCode.CommunityData,
        LookupWarningCode.IngredientsUnverified,
      ],
      evidence: [],
      cacheKey: {
        source: CatalogueSource.OpenBeautyFacts,
        id: '769915195854',
        url: 'https://theordinary.com/en-us/azelaic-acid-suspension-10-100407.html',
      },
      rawSource: {},
    });

    const result = await service.resolveBarcodeForScan('769915195854');

    expect(officialPageProvider.extract).not.toHaveBeenCalled();
    expect(productPageDiscoveryProvider.discover).not.toHaveBeenCalled();
    expect(openAiExtractorProvider.completeMissingFields).not.toHaveBeenCalled();
    expect(result?.identity.brand).toBe('The Ordinary');
    expect(result?.identity.description ?? null).toBeNull();
    expect(result?.identity.inciIngredients).toEqual([
      'Aqua (Water)',
      'Dimethicone',
      'Azelaic Acid',
    ]);
  });

  it('re-enriches sparse cached catalogue products before returning them', async () => {
    const cached = createSparseProduct('catalogue-1', 'Retinol Serum');

    repo.findOne.mockResolvedValue(cached);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );
    openAiExtractorProvider.completeMissingFields.mockResolvedValue({
      data: {
        identity: {
          description: 'A resurfacing serum for smoother-looking skin.',
          benefits: ['smoother texture'],
          suitedFor: ['combination'],
        },
        guidance: {
          cautions: ['Use sunscreen during the day.'],
        },
        manufacturer: {
          parentCompany: "L'Oréal",
          countryOfManufacture: 'FR',
          supportEmail: 'support@example.com',
          productUrl: 'https://example.com/product',
          websiteUrl: 'https://example.com',
        },
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/product',
          title: null,
        },
      ],
    });
    productPageDiscoveryProvider.discover.mockResolvedValue([]);

    const result = await service.resolveCandidate({
      id: cached.id,
      source: CatalogueSource.RitoraCatalogue,
    });

    expect(openAiExtractorProvider.completeMissingFields).toHaveBeenCalled();
    expect(result?.identity.description).toBe(
      'A resurfacing serum for smoother-looking skin.',
    );
    expect(result?.identity.benefits).toEqual(['smoother texture']);
    expect(result?.identity.suitedFor).toEqual(['combination']);
    expect(result?.guidance.cautions).toEqual([
      'Use sunscreen during the day.',
    ]);
    expect(result?.manufacturer.parentCompany).toBe("L'Oréal");
    expect(result?.manufacturer.countryOfManufacture).toBe('FR');
    expect(result?.manufacturer.supportEmail).toBe('support@example.com');
    expect(result?.manufacturer.productUrl).toBe('https://example.com/product');
    expect(repo.save).toHaveBeenCalled();
  });

  it('re-enriches cached products with likely truncated ingredient lists', async () => {
    const cached = createProduct('catalogue-ingredients-1', 'SA Cleanser');
    cached.identity = {
      ...cached.identity,
      description: 'A cleanser for smoother-looking skin.',
      benefits: ['smoother texture'],
      suitedFor: ['rough skin'],
      inciIngredients: ['Aqua / Water', 'Glycerin', 'Niacinamide', 'Sodium'],
    };
    cached.guidance = {
      ...cached.guidance,
      cautions: ['Avoid contact with eyes.'],
    };
    cached.manufacturer = {
      ...cached.manufacturer,
      parentCompany: "L'Oréal",
      countryOfManufacture: 'FR',
      supportEmail: 'support@example.com',
      productUrl: 'https://example.com/sa-cleanser',
      websiteUrl: 'https://example.com',
    };

    repo.findOne.mockResolvedValue(cached);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );
    officialPageProvider.extract.mockResolvedValue({
      identity: {
        brand: 'CeraVe',
        name: 'SA Cleanser',
        category: ProductCategory.Cleanser,
        barcode: 'barcode-catalogue-ingredients-1',
        imageUrls: [],
        sizeMl: 236,
        description: 'A cleanser for smoother-looking skin.',
        benefits: ['smoother texture'],
        suitedFor: ['rough skin'],
        inciIngredients: [
          'Aqua / Water',
          'Glycerin',
          'Niacinamide',
          'Sodium Hydroxide',
        ],
        inciLastConfirmedAt: new Date('2026-04-20T00:00:00.000Z').toISOString(),
      },
      guidance: {
        steps: ['Massage onto wet skin and rinse.'],
        cautions: ['Avoid contact with eyes.'],
      },
      manufacturer: {
        brand: 'CeraVe',
        parentCompany: "L'Oréal",
        countryOfManufacture: 'FR',
        supportEmail: 'support@example.com',
        productUrl: 'https://example.com/sa-cleanser',
        websiteUrl: 'https://example.com',
      },
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://example.com/sa-cleanser',
          title: 'SA Cleanser',
        },
      ],
      rawSource: {},
      textExcerpt:
        'Ingredients: Aqua / Water, Glycerin, Niacinamide, Sodium Hydroxide.',
    });
    openAiExtractorProvider.extract.mockResolvedValue(null);
    openAiExtractorProvider.completeMissingFields.mockResolvedValue(null);

    const result = await service.resolveCandidate({
      id: cached.id,
      source: CatalogueSource.RitoraCatalogue,
    });

    expect(officialPageProvider.extract).toHaveBeenCalledWith(
      'https://example.com/sa-cleanser',
    );
    expect(result?.identity.inciIngredients).toEqual([
      'Aqua / Water',
      'Glycerin',
      'Niacinamide',
      'Sodium Hydroxide',
    ]);
    expect(repo.save).toHaveBeenCalled();
  });

  it('drops stale cached ingredients and refetches the product', async () => {
    const staleProduct = createProduct(
      'catalogue-stale-1',
      'SA (Salicylic Acid ) Smoothing Cleanser with Ceramides',
    );
    staleProduct.source_type = CatalogueSource.OfficialPage;
    staleProduct.identity = {
      ...staleProduct.identity,
      barcode: '3337875684118',
      description: 'A cleanser for smoother-looking skin.',
      benefits: ['smoothing'],
      suitedFor: ['rough skin'],
      inciIngredients: ['Aqua / Water', 'Sodium Lauroyl Sarcosinate', 'Sodium'],
    };
    staleProduct.manufacturer = {
      ...staleProduct.manufacturer,
      productUrl:
        'https://www.ceravemy.com/en/ceramides-skin-care/cleansers/sa-smoothing-cleanser-with-salicylic-acid',
      websiteUrl: 'https://www.ceravemy.com',
    };

    let staleDeleted = false;
    repo.delete.mockImplementation(async () => {
      staleDeleted = true;
      return { affected: 1, raw: [] };
    });
    queryBuilder.getOne.mockImplementation(async () => {
      return staleDeleted ? null : staleProduct;
    });
    repo.findOne.mockImplementation(async () => {
      return null;
    });
    repo.create.mockReturnValue({} as CatalogueProduct);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );
    officialPageProvider.extract.mockResolvedValue({
      identity: {
        brand: 'CeraVe',
        name: 'SA (Salicylic Acid ) Smoothing Cleanser with Ceramides',
        category: ProductCategory.Cleanser,
        barcode: '3337875684118',
        imageUrls: [],
        sizeMl: 236,
        description: 'A cleanser for smoother-looking skin.',
        benefits: ['smoothing'],
        suitedFor: ['rough skin'],
        inciIngredients: [
          'Aqua / Water',
          'Sodium Lauroyl Sarcosinate',
          'Cocamidopropyl Hydroxysultaine',
          'Glycerin',
          'Niacinamide',
          'Gluconolactone',
          'Sodium Methyl Cocoyl Taurate',
          'PEG-150 Pentaerythrityl Tetrastearate',
          'Ceramide NP',
          'Ceramide AP',
          'Ceramide EOP',
          'Carbomer',
          'Calcium Gluconate',
          'Salicylic Acid',
          'Sodium Benzoate',
          'Sodium Hydroxide.',
        ],
        inciLastConfirmedAt: new Date('2026-04-20T00:00:00.000Z').toISOString(),
      },
      guidance: {
        steps: ['Massage cleanser onto wet skin and rinse.'],
        cautions: [],
      },
      manufacturer: {
        brand: 'CeraVe',
        productUrl:
          'https://www.ceravemy.com/en/ceramides-skin-care/cleansers/sa-smoothing-cleanser-with-salicylic-acid',
        websiteUrl: 'https://www.ceravemy.com',
      },
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://www.ceravemy.com/en/ceramides-skin-care/cleansers/sa-smoothing-cleanser-with-salicylic-acid',
          title: 'SA Smoothing Cleanser',
        },
      ],
      rawSource: {},
      textExcerpt:
        'Ingredients: Aqua / Water, Sodium Lauroyl Sarcosinate, Cocamidopropyl Hydroxysultaine, Glycerin, Niacinamide, Gluconolactone, Sodium Methyl Cocoyl Taurate, PEG-150 Pentaerythrityl Tetrastearate, Ceramide NP, Ceramide AP, Ceramide EOP, Carbomer, Calcium Gluconate, Salicylic Acid, Sodium Benzoate, Sodium Hydroxide.',
    });
    openAiExtractorProvider.extract.mockResolvedValue(null);
    openAiExtractorProvider.completeMissingFields.mockResolvedValue(null);

    const result = await service.resolveBarcode('3337875684118');

    expect(repo.delete).toHaveBeenCalledWith({ id: staleProduct.id });
    expect(officialPageProvider.extract).toHaveBeenCalledWith(
      'https://www.ceravemy.com/en/ceramides-skin-care/cleansers/sa-smoothing-cleanser-with-salicylic-acid',
    );
    expect(result?.identity.inciIngredients).toEqual([
      'Aqua / Water',
      'Sodium Lauroyl Sarcosinate',
      'Cocamidopropyl Hydroxysultaine',
      'Glycerin',
      'Niacinamide',
      'Gluconolactone',
      'Sodium Methyl Cocoyl Taurate',
      'PEG-150 Pentaerythrityl Tetrastearate',
      'Ceramide NP',
      'Ceramide AP',
      'Ceramide EOP',
      'Carbomer',
      'Calcium Gluconate',
      'Salicylic Acid',
      'Sodium Benzoate',
      'Sodium Hydroxide.',
    ]);
  });

  it('keeps open beauty facts fields and only fills missing fields from AI', async () => {
    const cached = createProduct('catalogue-obf-1', 'SA Smoothing Cleanser');
    cached.source_type = CatalogueSource.OpenBeautyFacts;
    cached.source_id = '3337875795456';
    cached.confidence = LookupConfidence.Low;
    cached.review_required = true;
    cached.warnings = [
      LookupWarningCode.ReviewRequired,
      LookupWarningCode.CommunityData,
    ];
    cached.identity = {
      ...cached.identity,
      description: 'Community description from Open Beauty Facts.',
      benefits: ['smooths texture'],
      suitedFor: ['rough skin'],
    };
    cached.manufacturer = {
      ...cached.manufacturer,
      productUrl:
        'https://www.cerave.co.uk/skincare/cleansers/sa-smoothing-cleanser',
      websiteUrl: 'https://www.cerave.co.uk',
      parentCompany: null,
      countryOfOrigin: null,
      countryOfManufacture: null,
      supportEmail: null,
    };

    repo.findOne.mockResolvedValue(cached);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );
    officialPageProvider.extract.mockResolvedValue(null);
    openAiExtractorProvider.completeMissingFields.mockResolvedValue({
      data: {
        identity: {
          description: 'Different AI description that should not overwrite.',
          benefits: ['different benefit'],
          suitedFor: ['different skin type'],
        },
        manufacturer: {
          parentCompany: "L'Oréal",
          countryOfOrigin: 'FR',
          countryOfManufacture: 'FR',
          supportEmail: 'support@example.com',
          productUrl: 'https://www.example.com/should-not-overwrite',
          websiteUrl: 'https://www.example.com',
        },
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://www.cerave.co.uk/skincare/cleansers/sa-smoothing-cleanser',
          title: 'SA Smoothing Cleanser | CeraVe',
        },
      ],
    });

    const result = await service.resolveCandidate({
      id: '3337875795456',
      source: CatalogueSource.OpenBeautyFacts,
    });

    expect(openAiExtractorProvider.completeMissingFields).toHaveBeenCalled();
    expect(result?.identity.description).toBe(
      'Community description from Open Beauty Facts.',
    );
    expect(result?.identity.benefits).toEqual(['smooths texture']);
    expect(result?.identity.suitedFor).toEqual(['rough skin']);
    expect(result?.manufacturer.productUrl).toBe(
      'https://www.cerave.co.uk/skincare/cleansers/sa-smoothing-cleanser',
    );
    expect(result?.manufacturer.parentCompany).toBe("L'Oréal");
    expect(result?.manufacturer.countryOfManufacture).toBe('FR');
    expect(result?.manufacturer.supportEmail).toBe('support@example.com');
    expect(result?.warnings).toContain(LookupWarningCode.CommunityData);
    expect(result?.warnings).toContain(LookupWarningCode.AiNormalized);
  });

  it('discovers and enriches an official product page for sparse external results', async () => {
    queryBuilder.getOne.mockResolvedValue(null);
    repo.findOne.mockResolvedValue(null);
    repo.create.mockReturnValue({} as CatalogueProduct);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );
    openBeautyFactsProvider.resolveBarcode.mockResolvedValue({
      identity: {
        brand: 'CeraVe',
        name: 'SA Smoothing Cleanser',
        category: ProductCategory.Cleanser,
        barcode: '3337875795456',
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
        brand: 'CeraVe',
      },
      provenance: 'catalogue',
      source: CatalogueSource.OpenBeautyFacts,
      confidence: LookupConfidence.Low,
      reviewRequired: true,
      warnings: [LookupWarningCode.ReviewRequired],
      evidence: [],
      cacheKey: {
        source: CatalogueSource.OpenBeautyFacts,
        id: '3337875795456',
        url: null,
      },
      rawSource: {},
    });
    productPageDiscoveryProvider.discover.mockResolvedValue([
      {
        url: 'https://www.cerave.co.uk/skincare/cleansers/sa-smoothing-cleanser',
        title: 'SA Smoothing Cleanser | CeraVe',
        snippet: 'Official CeraVe product page',
      },
    ]);
    officialPageProvider.extract.mockResolvedValue({
      identity: {
        brand: 'CeraVe',
        name: 'SA Smoothing Cleanser',
        category: ProductCategory.Cleanser,
        description: 'A smoothing cleanser for rough and bumpy skin.',
        benefits: ['smooths rough texture'],
        suitedFor: ['rough and bumpy skin'],
      },
      guidance: {
        cautions: ['Avoid contact with eyes.'],
      },
      manufacturer: {
        brand: 'CeraVe',
        productUrl:
          'https://www.cerave.co.uk/skincare/cleansers/sa-smoothing-cleanser',
        websiteUrl: 'https://www.cerave.co.uk',
      },
      evidence: [
        {
          source: CatalogueSource.OfficialPage,
          url: 'https://www.cerave.co.uk/skincare/cleansers/sa-smoothing-cleanser',
          title: 'SA Smoothing Cleanser | CeraVe',
        },
      ],
      rawSource: {},
      textExcerpt: 'Official product page excerpt',
    });
    openAiExtractorProvider.extract.mockResolvedValue({
      data: {
        identity: {
          benefits: ['smooths rough texture'],
          suitedFor: ['rough and bumpy skin'],
        },
        guidance: {
          cautions: ['Avoid contact with eyes.'],
        },
      },
      warnings: [LookupWarningCode.AiNormalized],
      evidence: [],
    });
    openAiExtractorProvider.completeMissingFields.mockResolvedValue(null);

    const result = await service.resolveBarcode('3337875795456');

    expect(productPageDiscoveryProvider.discover).toHaveBeenCalled();
    expect(result?.identity.description).toBe(
      'A smoothing cleanser for rough and bumpy skin.',
    );
    expect(result?.identity.benefits).toEqual(['smooths rough texture']);
    expect(result?.identity.suitedFor).toEqual(['rough and bumpy skin']);
    expect(result?.guidance.cautions).toEqual(['Avoid contact with eyes.']);
    expect(result?.manufacturer.productUrl).toBe(
      'https://www.cerave.co.uk/skincare/cleansers/sa-smoothing-cleanser',
    );
  });
});
