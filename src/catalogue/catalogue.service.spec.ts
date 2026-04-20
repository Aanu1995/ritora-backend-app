import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogueService } from './catalogue.service';
import { CatalogueProduct } from './entities/catalogue-product.entity';
import { decodeCursor } from '../common/utils/cursor-pagination';
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

describe('CatalogueService', () => {
  let service: CatalogueService;
  let repo: jest.Mocked<Repository<CatalogueProduct>>;
  let queryBuilder: ReturnType<typeof createMockQueryBuilder>;
  const openBeautyFactsProvider = {
    search: jest.fn(),
    resolveBarcode: jest.fn(),
  };
  const officialPageProvider = {
    extract: jest.fn(),
  };
  const openAiExtractorProvider = {
    extract: jest.fn(),
    completeMissingFields: jest.fn(),
    completeInteractiveMissingFields: jest.fn(),
    discoverIngredients: jest.fn(),
    searchByQuery: jest.fn(),
  };
  const productPageDiscoveryProvider = {
    search: jest.fn(),
    searchQuery: jest.fn(),
    searchGenericQuery: jest.fn(),
  };
  const catalogueSourceRuleService = {
    evaluateUrl: jest.fn(),
  };

  beforeEach(async () => {
    queryBuilder = createMockQueryBuilder();
    openBeautyFactsProvider.search.mockReset();
    openBeautyFactsProvider.resolveBarcode.mockReset();
    officialPageProvider.extract.mockReset();
    openAiExtractorProvider.extract.mockReset();
    openAiExtractorProvider.completeMissingFields.mockReset();
    openAiExtractorProvider.completeInteractiveMissingFields.mockReset();
    openAiExtractorProvider.discoverIngredients.mockReset();
    openAiExtractorProvider.searchByQuery.mockReset();
    productPageDiscoveryProvider.search.mockReset();
    productPageDiscoveryProvider.searchQuery.mockReset();
    productPageDiscoveryProvider.searchGenericQuery.mockReset();
    catalogueSourceRuleService.evaluateUrl.mockReset();
    productPageDiscoveryProvider.search.mockResolvedValue([]);
    productPageDiscoveryProvider.searchQuery.mockResolvedValue([]);
    productPageDiscoveryProvider.searchGenericQuery.mockResolvedValue([]);
    catalogueSourceRuleService.evaluateUrl.mockResolvedValue({
      blocked: false,
      scoreAdjustment: 0,
      matchedRuleId: null,
      labels: [],
    });

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
      ],
    }).compile();

    service = module.get<CatalogueService>(CatalogueService);
    repo = module.get(getRepositoryToken(CatalogueProduct));
    repo.createQueryBuilder.mockReturnValue(queryBuilder as never);
  });

  it('builds a stable next cursor that includes the product id', async () => {
    const first = createProduct('catalogue-1', 'Retinol Serum');
    const second = createProduct('catalogue-2', 'Retinol Serum');

    queryBuilder.getRawAndEntities.mockResolvedValue({
      entities: [first, second],
      raw: [
        { relevance: 1, source_priority: 0 },
        { relevance: 1, source_priority: 0 },
      ],
    });

    const result = await service.search({
      q: 'ret',
      limit: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeTruthy();

    const outerCursor = decodeCursor(result.nextCursor as string);
    expect(outerCursor.tuple[0]).toBe('internal');

    const internalCursor = decodeCursor(String(outerCursor.tuple[1]));
    expect(internalCursor.tuple).toEqual([
      1,
      0,
      'cerave',
      'retinol serum',
      'catalogue-1',
    ]);
  });

  it('resolves an exact cached match without calling external search', async () => {
    const cached = createProduct('catalogue-1', 'Resurfacing Retinol Serum');

    queryBuilder.getRawAndEntities.mockResolvedValue({
      entities: [cached],
      raw: [{ relevance: 0, source_priority: 0 }],
    });
    repo.findOne.mockResolvedValue(cached);

    const result = await service.searchBestMatch(
      'CeraVe Resurfacing Retinol Serum',
    );

    expect(openBeautyFactsProvider.search).not.toHaveBeenCalled();
    expect(result?.identity.brand).toBe('CeraVe');
    expect(result?.identity.name).toBe('Resurfacing Retinol Serum');
  });

  it('fully enriches an exact cached match for search best match', async () => {
    const cached = createSparseProduct(
      'catalogue-1',
      'Resurfacing Retinol Serum',
    );
    cached.manufacturer = {
      ...cached.manufacturer,
      productUrl: 'https://example.com/resurfacing-retinol-serum',
      websiteUrl: 'https://example.com',
    };

    queryBuilder.getRawAndEntities.mockResolvedValue({
      entities: [cached],
      raw: [{ relevance: 0, source_priority: 0 }],
    });
    repo.findOne.mockResolvedValue(cached);
    officialPageProvider.extract.mockResolvedValue({
      identity: {
        brand: 'CeraVe',
        name: 'Resurfacing Retinol Serum',
        category: ProductCategory.Serum,
        barcode: 'barcode-catalogue-1',
        imageUrls: [],
        sizeMl: 30,
        description: 'A resurfacing serum for smoother-looking skin.',
        benefits: ['smoother texture'],
        suitedFor: ['combination skin'],
        inciIngredients: ['Aqua', 'Niacinamide'],
        inciLastConfirmedAt: new Date('2026-04-20T00:00:00.000Z').toISOString(),
      },
      guidance: {
        steps: ['Apply to clean skin.'],
        cautions: ['Use sunscreen during the day.'],
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
      textExcerpt:
        'Benefits: smoother texture. Suitable for: combination skin. How to use: Apply to clean skin.',
    });
    openAiExtractorProvider.extract.mockResolvedValue(null);
    openAiExtractorProvider.completeMissingFields.mockResolvedValue(null);

    const result = await service.searchBestMatch(
      'CeraVe Resurfacing Retinol Serum',
    );

    expect(officialPageProvider.extract).toHaveBeenCalledWith(
      'https://example.com/resurfacing-retinol-serum',
    );
    expect(result?.identity.description).toBe(
      'A resurfacing serum for smoother-looking skin.',
    );
    expect(result?.identity.benefits).toEqual(['smoother texture']);
    expect(result?.identity.suitedFor).toEqual(['combination skin']);
    expect(result?.guidance.cautions).toEqual([
      'Use sunscreen during the day.',
    ]);
    expect(result?.manufacturer.parentCompany).toBe("L'Oréal");
    expect(result?.manufacturer.supportEmail).toBe('support@example.com');
    expect(result?.manufacturer.productUrl).toBe(
      'https://example.com/resurfacing-retinol-serum',
    );
  });

  it('returns null for an ambiguous broad query', async () => {
    const first = createProduct('catalogue-1', 'Hydrating Cleanser');
    const second = createProduct('catalogue-2', 'Foaming Cleanser');

    queryBuilder.getRawAndEntities.mockResolvedValue({
      entities: [first, second],
      raw: [
        { relevance: 0, source_priority: 0 },
        { relevance: 0, source_priority: 0 },
      ],
    });
    openBeautyFactsProvider.search.mockResolvedValue({
      items: [],
      hasMore: false,
    });
    productPageDiscoveryProvider.searchQuery.mockResolvedValue([]);

    const result = await service.searchBestMatch('cerave');

    expect(result).toBeNull();
  });

  it('falls back to external search when cached matches are not decisive', async () => {
    const cached = createProduct('catalogue-1', 'Moisturizing Lotion');

    queryBuilder.getRawAndEntities.mockResolvedValue({
      entities: [cached],
      raw: [{ relevance: 2, source_priority: 0 }],
    });
    queryBuilder.getOne.mockResolvedValue(null);
    openBeautyFactsProvider.search.mockResolvedValue({
      items: [
        {
          id: '3337875684118',
          source: CatalogueSource.OpenBeautyFacts,
          brand: 'CeraVe',
          name: 'Resurfacing Retinol Serum',
          category: ProductCategory.Serum,
          imageUrls: [],
          sizeMl: 30,
          barcode: '3337875684118',
          confidence: LookupConfidence.Low,
          reviewRequired: true,
        },
      ],
      hasMore: false,
    });
    openBeautyFactsProvider.resolveBarcode.mockResolvedValue({
      identity: {
        brand: 'CeraVe',
        name: 'Resurfacing Retinol Serum',
        category: ProductCategory.Serum,
        barcode: '3337875684118',
        imageUrls: [],
        sizeMl: 30,
        description: 'A resurfacing serum for smoother-looking skin.',
        benefits: ['smoother texture'],
        suitedFor: ['combination'],
        inciIngredients: [],
        inciLastConfirmedAt: null,
      },
      guidance: {},
      manufacturer: {
        brand: 'CeraVe',
        productUrl: 'https://example.com/product',
        websiteUrl: 'https://example.com',
      },
      provenance: 'catalogue',
      source: CatalogueSource.OpenBeautyFacts,
      confidence: LookupConfidence.Low,
      reviewRequired: true,
      warnings: [LookupWarningCode.ReviewRequired],
      evidence: [],
      cacheKey: {
        source: CatalogueSource.OpenBeautyFacts,
        id: '3337875684118',
        url: 'https://example.com/product',
      },
      rawSource: {},
    });
    repo.findOne.mockResolvedValue(null);
    repo.create.mockReturnValue({} as CatalogueProduct);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );
    officialPageProvider.extract.mockResolvedValue(null);
    openAiExtractorProvider.completeMissingFields.mockResolvedValue(null);
    productPageDiscoveryProvider.search.mockResolvedValue([]);

    const result = await service.searchBestMatch('retinol serum');

    expect(openBeautyFactsProvider.search).toHaveBeenCalledWith(
      'retinol serum',
      1,
    );
    expect(openBeautyFactsProvider.resolveBarcode).toHaveBeenCalledWith(
      '3337875684118',
      'catalogue',
    );
    expect(result?.identity.name).toBe('Resurfacing Retinol Serum');
  });

  it('fills missing ingredients from deterministic search results even when AI completion returns nothing', async () => {
    queryBuilder.getRawAndEntities.mockResolvedValue({
      entities: [],
      raw: [],
    });
    openBeautyFactsProvider.search.mockResolvedValue({
      items: [],
      hasMore: false,
    });
    productPageDiscoveryProvider.searchQuery.mockResolvedValue([
      {
        url: 'https://theordinary.com/en-us/azelaic-acid-suspension-10-100407.html',
        title: 'Azelaic Acid Suspension 10% - The Ordinary',
        snippet: 'Official The Ordinary product page',
      },
    ]);
    officialPageProvider.extract
      .mockResolvedValueOnce({
        identity: {
          brand: 'The Ordinary',
          name: 'Azelaic Acid Suspension 10%',
          category: ProductCategory.Exfoliant,
          description:
            'A cream-like formula that visibly improves brightness and texture.',
          benefits: ['brightening'],
          suitedFor: ['blemish-prone skin'],
          inciIngredients: [],
        },
        guidance: {},
        manufacturer: {
          brand: 'The Ordinary',
          productUrl:
            'https://theordinary.com/en-us/azelaic-acid-suspension-10-100407.html',
          websiteUrl: 'https://theordinary.com',
        },
        evidence: [],
        rawSource: {},
        textExcerpt: 'Official product page excerpt',
      })
      .mockResolvedValueOnce({
        identity: {
          brand: 'The Ordinary',
          name: 'The Ordinary Azelaic Acid Suspension 10%',
          category: ProductCategory.Exfoliant,
          inciIngredients: [
            'Aqua (Water)',
            'Isodecyl Neopentanoate',
            'Dimethicone',
            'Azelaic Acid',
          ],
          inciLastConfirmedAt: new Date(
            '2026-04-20T00:00:00.000Z',
          ).toISOString(),
        },
        guidance: {},
        manufacturer: {
          brand: 'The Ordinary',
          websiteUrl: 'https://incidecoder.com',
        },
        evidence: [
          {
            source: CatalogueSource.OfficialPage,
            url: 'https://incidecoder.com/products/the-ordinary-azelaic-acid-suspension-10',
            title: 'The Ordinary Azelaic Acid Suspension 10% ingredients',
          },
        ],
        rawSource: {},
        textExcerpt:
          'Ingredients: Aqua (Water), Isodecyl Neopentanoate, Dimethicone, Azelaic Acid.',
      });
    openAiExtractorProvider.completeInteractiveMissingFields.mockResolvedValue(
      null,
    );
    openAiExtractorProvider.discoverIngredients.mockResolvedValue(null);
    productPageDiscoveryProvider.searchGenericQuery.mockResolvedValue([
      {
        url: 'https://incidecoder.com/products/the-ordinary-azelaic-acid-suspension-10',
        title:
          'The Ordinary Azelaic Acid Suspension 10% ingredients (Explained)',
        snippet: 'Ingredients explained',
      },
    ]);
    repo.create.mockReturnValue({} as CatalogueProduct);
    repo.save.mockImplementation(
      async (product) => product as CatalogueProduct,
    );

    const result = await service.searchBestMatch(
      'The Ordinary Azelaic Acid Suspension 10%',
    );

    expect(
      productPageDiscoveryProvider.searchGenericQuery,
    ).toHaveBeenCalledWith(
      'The Ordinary Azelaic Acid Suspension 10% ingredients',
    );
    expect(
      openAiExtractorProvider.completeInteractiveMissingFields,
    ).not.toHaveBeenCalled();
    expect(result?.identity.inciIngredients).toEqual([
      'Aqua (Water)',
      'Isodecyl Neopentanoate',
      'Dimethicone',
      'Azelaic Acid',
    ]);
    expect(result?.warnings).toContain(LookupWarningCode.IngredientsUnverified);
  });

  it('rejects unsafe private-network URLs during URL resolution', async () => {
    await expect(
      service.resolveUrl('http://127.0.0.1:3000/private-product'),
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
    productPageDiscoveryProvider.search.mockResolvedValue([]);

    const result = await service.resolveBarcode('3337875684118');

    expect(openAiExtractorProvider.completeMissingFields).toHaveBeenCalled();
    expect(result?.identity.brand).toBe('CeraVe');
    expect(result?.identity.name).toBe('Resurfacing Retinol Serum');
    expect(result?.manufacturer.productUrl).toBe('https://example.com/product');
    expect(result?.confidence).toBe(LookupConfidence.High);
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
    productPageDiscoveryProvider.search.mockResolvedValue([]);

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
    productPageDiscoveryProvider.search.mockResolvedValue([
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

    expect(productPageDiscoveryProvider.search).toHaveBeenCalled();
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
