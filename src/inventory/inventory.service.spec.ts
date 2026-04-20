import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryService } from './inventory.service';
import { InventoryProduct } from './entities/inventory-product.entity';
import {
  DataProvenance,
  ProductCategory,
  ShelfSort,
  ShelfStatFilter,
  ShelfStatus,
  type ShelfProductSnapshot,
} from '../shelf/shelf.types';

const createMockQueryBuilder = () => ({
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  setParameters: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getCount: jest.fn(),
  getRawOne: jest.fn(),
});

const mockRepository = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn().mockImplementation((data) => data),
  save: jest.fn().mockImplementation(async (data) => data),
  remove: jest.fn().mockImplementation(async (data) => data),
  delete: jest.fn().mockImplementation(async () => ({ affected: 0 })),
  update: jest.fn().mockImplementation(async () => ({ affected: 0 })),
  createQueryBuilder: jest.fn(),
});

function createSnapshot(
  overrides?: Partial<ShelfProductSnapshot>,
): ShelfProductSnapshot {
  return {
    identity: {
      brand: 'CeraVe',
      name: 'Resurfacing Retinol Serum',
      category: ProductCategory.Serum,
      barcode: '3337875597227',
      imageUrls: [],
      sizeMl: 30,
      description: 'A gentle nightly retinol serum.',
      benefits: ['smoothing'],
      suitedFor: ['sensitive'],
      inciIngredients: ['Aqua', 'Glycerin', 'Retinol'],
      inciLastConfirmedAt: '2026-04-18T00:00:00.000Z',
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: ['Apply to clean skin.'],
      cautions: ['Avoid the eye area.'],
      waitMinutes: null,
    },
    manufacturer: {
      brand: 'CeraVe',
      parentCompany: "L'Oréal",
      countryOfOrigin: 'US',
      countryOfManufacture: 'US',
      supportEmail: 'support@cerave.com',
      productUrl:
        'https://www.cerave.com/skincare/serums/resurfacing-retinol-serum',
      websiteUrl: 'https://www.cerave.com',
    },
    userFields: {
      openedAt: null,
      expiresAt: null,
      periodAfterOpeningMonths: 12,
      pricePaid: null,
      pricePaidCurrency: null,
      purchasedFrom: null,
      personalNotes: null,
      preferredTimeOfDay: null,
    },
    status: ShelfStatus.Active,
    provenance: DataProvenance.UserEntered,
    ...overrides,
  };
}

function createEntity(
  id: string,
  overrides?: Partial<InventoryProduct>,
): InventoryProduct {
  const snapshot = createSnapshot();
  return {
    id,
    user_id: 'user-1',
    brand: snapshot.identity.brand,
    name: snapshot.identity.name,
    category: snapshot.identity.category,
    barcode: snapshot.identity.barcode,
    status: snapshot.status,
    provenance: snapshot.provenance,
    brand_search: snapshot.identity.brand.toLowerCase(),
    name_search: snapshot.identity.name.toLowerCase(),
    search_document:
      `${snapshot.identity.brand} ${snapshot.identity.name}`.toLowerCase(),
    opened_at: null,
    expires_at: null,
    period_after_opening_months: 12,
    effective_expires_at: null,
    identity: snapshot.identity,
    guidance: snapshot.guidance,
    manufacturer: snapshot.manufacturer,
    user_fields: snapshot.userFields,
    created_at: new Date('2026-04-18T00:00:00.000Z'),
    updated_at: new Date('2026-04-18T00:00:00.000Z'),
    user: undefined as never,
    ...overrides,
  } as InventoryProduct;
}

describe('InventoryService', () => {
  let service: InventoryService;
  let repo: jest.Mocked<Repository<InventoryProduct>>;
  let queryBuilder: ReturnType<typeof createMockQueryBuilder>;

  beforeEach(async () => {
    queryBuilder = createMockQueryBuilder();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getRepositoryToken(InventoryProduct),
          useFactory: mockRepository,
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    repo = module.get(getRepositoryToken(InventoryProduct));
    repo.createQueryBuilder.mockReturnValue(queryBuilder as never);
  });

  it('creates an inventory product with normalized snapshot fields', async () => {
    const draft = createSnapshot({
      manufacturer: {
        ...createSnapshot().manufacturer,
        brand: '',
      },
    });
    const saved = createEntity('inventory-1', {
      manufacturer: {
        ...createSnapshot().manufacturer,
        brand: 'CeraVe',
      },
    });

    repo.save.mockResolvedValue(saved);

    const result = await service.create('user-1', draft as never);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        status: ShelfStatus.Active,
        provenance: DataProvenance.UserEntered,
        search_document: expect.stringContaining('cerave'),
        manufacturer: expect.objectContaining({
          brand: 'CeraVe',
        }),
      }),
    );
    expect(result.id).toBe('inventory-1');
  });

  it('archives, restores, and marks products as finished', async () => {
    const entity = createEntity('inventory-1');
    repo.findOne.mockResolvedValue(entity);
    repo.save.mockImplementation(async (value) => value as InventoryProduct);

    const archived = await service.archive('user-1', 'inventory-1');
    const restored = await service.restore('user-1', 'inventory-1');
    const finished = await service.markFinished('user-1', 'inventory-1');

    expect(archived.status).toBe(ShelfStatus.Archived);
    expect(restored.status).toBe(ShelfStatus.Active);
    expect(finished.status).toBe(ShelfStatus.FinishedUp);
  });

  it('returns paginated inventory lists with a next cursor', async () => {
    queryBuilder.getMany.mockResolvedValue(
      Array.from({ length: 31 }, (_, index) =>
        createEntity(`inventory-${index + 1}`, {
          name: `Product ${String(index + 1).padStart(2, '0')}`,
          name_search: `product ${String(index + 1).padStart(2, '0')}`,
          identity: {
            ...createSnapshot().identity,
            name: `Product ${String(index + 1).padStart(2, '0')}`,
          },
          created_at: new Date(
            `2026-04-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
          ),
          updated_at: new Date(
            `2026-04-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
          ),
        }),
      ),
    );

    const result = await service.list('user-1', {
      stat: ShelfStatFilter.All,
      category: 'all',
      search: '',
      sort: ShelfSort.RecentlyAdded,
      limit: 30,
    });

    expect(result.items).toHaveLength(30);
    expect(result.nextCursor).toBeTruthy();
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('derives shelf stats from user inventory', async () => {
    const statsBuilder = createMockQueryBuilder();
    statsBuilder.getRawOne.mockResolvedValue({
      [ShelfStatFilter.All]: '1',
      [ShelfStatFilter.InUse]: '1',
      [ShelfStatFilter.Unopened]: '0',
      [ShelfStatFilter.NearingExpiry]: '0',
      [ShelfStatFilter.Expired]: '0',
      [ShelfStatFilter.Archived]: '1',
    });

    repo.createQueryBuilder.mockReturnValueOnce(statsBuilder as never);

    const stats = await service.getStats('user-1');

    expect(stats[ShelfStatFilter.All]).toBe(1);
    expect(stats[ShelfStatFilter.InUse]).toBe(1);
    expect(stats[ShelfStatFilter.Archived]).toBe(1);
    expect(statsBuilder.getRawOne).toHaveBeenCalled();
  });
});
