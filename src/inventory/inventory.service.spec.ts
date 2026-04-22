import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CataloguePhotoProcessorService } from '../catalogue/catalogue-photo-processor.service';
import { CataloguePhotoStorageService } from '../catalogue/catalogue-photo-storage.service';
import type { UploadedCatalogueImage } from '../catalogue/catalogue-photo.types';
import { decodeCursor } from '../common/utils/cursor-pagination';
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
  const cataloguePhotoProcessorService = {
    prepareHeroImageForStorage: jest.fn(),
  };
  const cataloguePhotoStorageService = {
    saveHeroImage: jest.fn(),
    toPersistentImageUrls: jest.fn((imageUrls: string[]) => imageUrls),
    resolvePublicImageUrls: jest.fn((imageUrls: string[]) => imageUrls),
  };

  beforeEach(async () => {
    queryBuilder = createMockQueryBuilder();
    cataloguePhotoProcessorService.prepareHeroImageForStorage.mockClear();
    cataloguePhotoStorageService.saveHeroImage.mockClear();
    cataloguePhotoStorageService.toPersistentImageUrls.mockClear();
    cataloguePhotoStorageService.resolvePublicImageUrls.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getRepositoryToken(InventoryProduct),
          useFactory: mockRepository,
        },
        {
          provide: CataloguePhotoProcessorService,
          useValue: cataloguePhotoProcessorService,
        },
        {
          provide: CataloguePhotoStorageService,
          useValue: cataloguePhotoStorageService,
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    repo = module.get(getRepositoryToken(InventoryProduct));
    repo.createQueryBuilder.mockReturnValue(queryBuilder as never);
  });

  afterEach(() => {
    jest.useRealTimers();
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
    const createPayload = repo.create.mock.calls[0]?.[0] as
      | Partial<InventoryProduct>
      | undefined;

    expect(createPayload).toBeDefined();
    expect(createPayload?.user_id).toBe('user-1');
    expect(createPayload?.status).toBe(ShelfStatus.Active);
    expect(createPayload?.provenance).toBe(DataProvenance.UserEntered);
    expect(createPayload?.search_document).toContain('cerave');
    expect(createPayload?.manufacturer?.brand).toBe('CeraVe');
    expect(
      cataloguePhotoStorageService.toPersistentImageUrls,
    ).toHaveBeenCalled();
    expect(result.id).toBe('inventory-1');
  });

  it('stores managed media as stable refs and re-signs them for responses', async () => {
    const managedUrl =
      'https://d111111abcdef8.cloudfront.net/product-images/processed/photo.webp?Policy=test&Signature=test&Key-Pair-Id=test';
    const persistedUrl =
      'https://d111111abcdef8.cloudfront.net/product-images/processed/photo.webp';
    const signedUrl = `${persistedUrl}?Policy=fresh`;
    const draft = createSnapshot({
      identity: {
        ...createSnapshot().identity,
        imageUrls: [managedUrl],
      },
    });
    const saved = createEntity('inventory-2', {
      identity: {
        ...draft.identity,
        imageUrls: [persistedUrl],
      },
    });

    cataloguePhotoStorageService.toPersistentImageUrls.mockReturnValueOnce([
      persistedUrl,
    ]);
    cataloguePhotoStorageService.resolvePublicImageUrls.mockReturnValueOnce([
      signedUrl,
    ]);
    repo.save.mockResolvedValue(saved);

    const result = await service.create('user-1', draft as never);

    expect(
      cataloguePhotoStorageService.toPersistentImageUrls,
    ).toHaveBeenCalledWith([managedUrl]);
    expect(
      cataloguePhotoStorageService.resolvePublicImageUrls,
    ).toHaveBeenCalledWith([persistedUrl]);
    expect(result.identity.imageUrls).toEqual([signedUrl]);
  });

  it('processes and uploads a product image for edit flows', async () => {
    const uploadedImage: UploadedCatalogueImage = {
      originalname: 'product.jpg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('image'),
      size: 5,
    };
    const processedImage = {
      ...uploadedImage,
      originalname: 'product.webp',
      mimetype: 'image/webp',
      width: 800,
      height: 800,
      size: 12,
    };
    const imageUrl =
      'https://signed.example.com/product-images/processed/photo.webp';

    cataloguePhotoProcessorService.prepareHeroImageForStorage.mockResolvedValue(
      processedImage,
    );
    cataloguePhotoStorageService.saveHeroImage.mockResolvedValue(imageUrl);

    const result = await service.uploadProductImage(uploadedImage);

    expect(
      cataloguePhotoProcessorService.prepareHeroImageForStorage,
    ).toHaveBeenCalledWith(uploadedImage);
    expect(cataloguePhotoStorageService.saveHeroImage).toHaveBeenCalledWith(
      processedImage,
    );
    expect(result).toBe(imageUrl);
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

  it('uses the saved timezone ahead of the request timezone for date-based inventory filters', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T03:00:00.000Z'));
    queryBuilder.getMany.mockResolvedValue([]);

    await service.list(
      'user-1',
      {
        stat: ShelfStatFilter.Expired,
        category: 'all',
        search: '',
        sort: ShelfSort.RecentlyAdded,
        limit: 30,
      },
      'Europe/Stockholm',
      'America/New_York',
    );

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining(
        'inventory.effective_expires_at <= :todayStartUtc',
      ),
      expect.objectContaining({
        todayStartUtc: '2026-04-02T00:00:00.000Z',
      }),
    );
  });

  it('keeps non-date-sensitive list cursor fingerprints stable across day rollover', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-23T21:59:59.000Z'));
    queryBuilder.getMany.mockResolvedValue([
      createEntity('inventory-1'),
      createEntity('inventory-2'),
    ]);

    const firstPage = await service.list(
      'user-1',
      {
        stat: ShelfStatFilter.All,
        category: 'all',
        search: '',
        sort: ShelfSort.RecentlyAdded,
        limit: 1,
      },
      'Europe/Stockholm',
    );

    jest.setSystemTime(new Date('2026-04-23T22:00:01.000Z'));
    queryBuilder.getMany.mockResolvedValue([
      createEntity('inventory-1'),
      createEntity('inventory-2'),
    ]);

    const secondPage = await service.list(
      'user-1',
      {
        stat: ShelfStatFilter.All,
        category: 'all',
        search: '',
        sort: ShelfSort.RecentlyAdded,
        limit: 1,
      },
      'Europe/Stockholm',
    );

    expect(firstPage.nextCursor).toBeTruthy();
    expect(secondPage.nextCursor).toBeTruthy();
    expect(decodeCursor(firstPage.nextCursor as string).fingerprint).toBe(
      decodeCursor(secondPage.nextCursor as string).fingerprint,
    );
  });

  it('changes date-sensitive list cursor fingerprints across day rollover', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-23T21:59:59.000Z'));
    queryBuilder.getMany.mockResolvedValue([
      createEntity('inventory-1', {
        opened_at: new Date('2026-04-01T00:00:00.000Z'),
        effective_expires_at: new Date('2026-04-24T00:00:00.000Z'),
      }),
      createEntity('inventory-2', {
        opened_at: new Date('2026-04-01T00:00:00.000Z'),
        effective_expires_at: new Date('2026-04-25T00:00:00.000Z'),
      }),
    ]);

    const firstPage = await service.list(
      'user-1',
      {
        stat: ShelfStatFilter.Expired,
        category: 'all',
        search: '',
        sort: ShelfSort.RecentlyAdded,
        limit: 1,
      },
      'Europe/Stockholm',
    );

    jest.setSystemTime(new Date('2026-04-23T22:00:01.000Z'));
    queryBuilder.getMany.mockResolvedValue([
      createEntity('inventory-1', {
        opened_at: new Date('2026-04-01T00:00:00.000Z'),
        effective_expires_at: new Date('2026-04-24T00:00:00.000Z'),
      }),
      createEntity('inventory-2', {
        opened_at: new Date('2026-04-01T00:00:00.000Z'),
        effective_expires_at: new Date('2026-04-25T00:00:00.000Z'),
      }),
    ]);

    const secondPage = await service.list(
      'user-1',
      {
        stat: ShelfStatFilter.Expired,
        category: 'all',
        search: '',
        sort: ShelfSort.RecentlyAdded,
        limit: 1,
      },
      'Europe/Stockholm',
    );

    expect(firstPage.nextCursor).toBeTruthy();
    expect(secondPage.nextCursor).toBeTruthy();
    expect(decodeCursor(firstPage.nextCursor as string).fingerprint).not.toBe(
      decodeCursor(secondPage.nextCursor as string).fingerprint,
    );
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

  it('falls back to the request timezone for stats when no saved timezone exists', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-02T03:00:00.000Z'));
    const statsBuilder = createMockQueryBuilder();
    statsBuilder.getRawOne.mockResolvedValue({
      [ShelfStatFilter.All]: '0',
      [ShelfStatFilter.InUse]: '0',
      [ShelfStatFilter.Unopened]: '0',
      [ShelfStatFilter.NearingExpiry]: '0',
      [ShelfStatFilter.Expired]: '0',
      [ShelfStatFilter.Archived]: '0',
    });

    repo.createQueryBuilder.mockReturnValueOnce(statsBuilder as never);

    await service.getStats('user-1', null, 'America/New_York');

    expect(statsBuilder.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        todayStartUtc: '2026-04-01T00:00:00.000Z',
      }),
    );
  });
});
