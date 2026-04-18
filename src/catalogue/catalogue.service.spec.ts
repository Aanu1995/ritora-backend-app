import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogueService } from './catalogue.service';
import { CatalogueProduct } from './entities/catalogue-product.entity';
import { decodeCursor } from '../common/utils/cursor-pagination';
import { ProductCategory } from '../shelf/shelf.types';

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
    created_at: new Date('2026-04-18T00:00:00.000Z'),
    updated_at: new Date('2026-04-18T00:00:00.000Z'),
    generateId: jest.fn(),
  } as CatalogueProduct;
}

describe('CatalogueService', () => {
  let service: CatalogueService;
  let repo: jest.Mocked<Repository<CatalogueProduct>>;
  let queryBuilder: ReturnType<typeof createMockQueryBuilder>;

  beforeEach(async () => {
    queryBuilder = createMockQueryBuilder();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogueService,
        {
          provide: getRepositoryToken(CatalogueProduct),
          useFactory: mockRepository,
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
      raw: [{ relevance: 1 }, { relevance: 1 }],
    });

    const result = await service.search({
      q: 'ret',
      limit: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeTruthy();

    const decoded = decodeCursor(result.nextCursor as string);
    expect(decoded.tuple).toEqual([
      1,
      'cerave',
      'retinol serum',
      'catalogue-1',
    ]);
  });
});
