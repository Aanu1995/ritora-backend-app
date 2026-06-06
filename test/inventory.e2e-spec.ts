import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CATALOGUE_PRODUCT_DRAFT_UPLOAD_FIELD,
  CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD,
} from '../src/catalogue/catalogue-photo.constants';
import { CataloguePhotoProcessorService } from '../src/catalogue/catalogue-photo-processor.service';
import { CataloguePhotoStorageService } from '../src/catalogue/catalogue-photo-storage.service';
import {
  ApplicationMethod,
  DataProvenance,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfStatFilter,
  ShelfStatus,
  type ApplicationGuidance,
  type CatalogueIdentity,
  type ManufacturerInfo,
  type UserFields,
} from '../src/shelf/shelf.types';
import {
  closeTestApp,
  createCompletedSkinProfile,
  createTestApp,
  MockMailService,
  truncateTables,
} from './test-setup';

const ORIGIN = 'http://localhost:3000';
const TEST_USER = {
  email: 'inventory@example.com',
  password: 'TestPass1',
  firstName: 'Inventory',
  lastName: 'Test',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

type InventoryApiProduct = {
  id: string;
  identity: CatalogueIdentity;
  guidance: ApplicationGuidance;
  manufacturer: ManufacturerInfo;
  userFields: UserFields;
  status: ShelfStatus;
  provenance: DataProvenance;
  createdAt: string;
  updatedAt: string;
};

type InventoryListResponse = {
  items: InventoryApiProduct[];
  nextCursor: string | null;
};

type InventoryImageUploadResponse = {
  imageUrl: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertInventoryProduct(
  value: unknown,
): asserts value is InventoryApiProduct {
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new Error('Inventory response body did not include a valid product');
  }
}

function getAccessTokenFromResponse(res: request.Response): string {
  const body = res.body as { accessToken?: unknown };

  if (typeof body.accessToken !== 'string') {
    throw new Error('Auth response did not include a string accessToken');
  }

  return body.accessToken;
}

function getInventoryProductFromResponse(
  res: request.Response,
): InventoryApiProduct {
  const body = res.body as unknown;
  assertInventoryProduct(body);
  return body;
}

function getInventoryListFromResponse(
  res: request.Response,
): InventoryListResponse {
  const body = res.body as unknown;

  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw new Error('Inventory list response did not include an items array');
  }

  for (const item of body.items) {
    assertInventoryProduct(item);
  }

  return {
    items: body.items as InventoryApiProduct[],
    nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
  };
}

function getInventoryStatsFromResponse(
  res: request.Response,
): Record<ShelfStatFilter, number> {
  const body = res.body as Record<string, unknown>;
  const stats = {} as Record<ShelfStatFilter, number>;

  for (const key of Object.values(ShelfStatFilter)) {
    const value = body[key];
    if (typeof value !== 'number') {
      throw new Error(`Inventory stats response did not include ${key}`);
    }

    stats[key] = value;
  }

  return stats;
}

function getUploadImageResponse(
  res: request.Response,
): InventoryImageUploadResponse {
  const body = res.body as { imageUrl?: unknown };

  if (typeof body.imageUrl !== 'string') {
    throw new Error('Upload image response did not include imageUrl');
  }

  return {
    imageUrl: body.imageUrl,
  };
}

function toUtcMidnightIso(daysOffset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysOffset);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function stripQueryString(url: string): string {
  return url.replace(/\?.*$/, '');
}

function toSignedPublicUrl(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}signed=fresh`;
}

function createInventoryDraft(overrides?: {
  brand?: string;
  name?: string;
  category?: ProductCategory;
  barcode?: string | null;
  imageUrls?: string[];
  description?: string;
  benefits?: string[];
  suitedFor?: string[];
  inciIngredients?: string[];
  openedAt?: string | null;
  expiresAt?: string | null;
  periodAfterOpeningMonths?: number | null;
  pricePaid?: number | null;
  personalNotes?: string | null;
  preferredTimeOfDay?: PreferredTimeOfDay | null;
  status?: ShelfStatus;
  provenance?: DataProvenance;
}) {
  const brand = overrides?.brand ?? 'CeraVe';
  const name = overrides?.name ?? 'Resurfacing Retinol Serum';

  return {
    identity: {
      brand,
      name,
      category: overrides?.category ?? ProductCategory.Serum,
      barcode: overrides?.barcode ?? '3337875597227',
      imageUrls: overrides?.imageUrls ?? [
        'https://cdn.example.com/product-images/processed/source.webp?Policy=input',
      ],
      sizeMl: 30,
      description:
        overrides?.description ?? 'A gentle nightly retinol serum for texture.',
      benefits: overrides?.benefits ?? ['smoothing'],
      suitedFor: overrides?.suitedFor ?? ['sensitive'],
      inciIngredients: overrides?.inciIngredients ?? [
        'Aqua',
        'Glycerin',
        'Retinol',
      ],
      inciLastConfirmedAt: toUtcMidnightIso(-7),
    },
    guidance: {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.PeaSize,
      steps: ['Apply to clean skin.'],
      cautions: ['Avoid the eye area.'],
      waitMinutes: 5,
    },
    manufacturer: {
      brand,
      parentCompany: "L'Oréal",
      countryOfOrigin: 'US',
      countryOfManufacture: 'US',
      supportEmail: 'support@cerave.com',
      productUrl:
        'https://www.cerave.com/skincare/serums/resurfacing-retinol-serum',
      websiteUrl: 'https://www.cerave.com',
    },
    userFields: {
      openedAt: overrides?.openedAt ?? null,
      expiresAt: overrides?.expiresAt ?? null,
      periodAfterOpeningMonths: overrides?.periodAfterOpeningMonths ?? 12,
      pricePaid: overrides?.pricePaid ?? 24.5,
      pricePaidCurrency: 'USD',
      purchasedFrom: 'Dermstore',
      personalNotes: overrides?.personalNotes ?? null,
      preferredTimeOfDay:
        overrides?.preferredTimeOfDay ?? PreferredTimeOfDay.Evening,
    },
    status: overrides?.status ?? ShelfStatus.Active,
    provenance: overrides?.provenance ?? DataProvenance.PhotoLookup,
  };
}

describe('Inventory (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;
  let accessToken: string;

  const cataloguePhotoProcessorService = {
    prepareHeroImageForStorage: jest.fn(
      async (file: { buffer: Buffer; originalname: string; size: number }) => ({
        ...file,
        originalname: 'processed-product.webp',
        mimetype: 'image/webp',
        width: 800,
        height: 800,
        size: file.size,
      }),
    ),
  };

  const cataloguePhotoStorageService = {
    startHeroImageUpload: jest.fn(() => ({
      url: Promise.resolve(
        'https://cdn.example.com/product-images/processed/uploaded-image.webp?signed=upload',
      ),
      cleanup: jest.fn().mockResolvedValue(undefined),
    })),
    saveHeroImage: jest.fn(
      async () =>
        'https://cdn.example.com/product-images/processed/uploaded-image.webp?signed=upload',
    ),
    toPersistentImageUrls: jest.fn((imageUrls: string[]) =>
      imageUrls.map((imageUrl) => stripQueryString(imageUrl)),
    ),
    resolvePublicImageUrls: jest.fn((imageUrls: string[]) =>
      imageUrls.map((imageUrl) => toSignedPublicUrl(imageUrl)),
    ),
  };

  beforeAll(async () => {
    mockMail = new MockMailService();
    app = await createTestApp(mockMail, [
      {
        provider: CataloguePhotoProcessorService,
        useValue: cataloguePhotoProcessorService,
      },
      {
        provider: CataloguePhotoStorageService,
        useValue: cataloguePhotoStorageService,
      },
    ]);
  });

  beforeEach(async () => {
    await truncateTables(app);
    mockMail.clear();
    jest.clearAllMocks();

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send(TEST_USER)
      .expect(201);

    const token = mockMail.getVerificationToken(TEST_USER.email);
    expect(token).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token })
      .expect(200);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({
        email: TEST_USER.email,
        password: TEST_USER.password,
      })
      .expect(200);

    accessToken = getAccessTokenFromResponse(loginResponse);
    await createCompletedSkinProfile(app, accessToken);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  function authGet(path: string, query?: Record<string, string | number>) {
    const req = request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`);

    return query ? req.query(query) : req;
  }

  function authGetWithTimeZone(
    path: string,
    timeZone: string,
    query?: Record<string, string | number>,
  ) {
    const req = authGet(path, query).set('X-Timezone', timeZone);
    return req;
  }

  function authPost(path: string, body?: Record<string, unknown>) {
    const req = request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN);

    return body ? req.send(body) : req;
  }

  function authPatch(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  }

  function authDelete(path: string) {
    return request(app.getHttpServer())
      .delete(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  it('creates, lists, and retrieves inventory products', async () => {
    const createResponse = await authPost(
      '/inventory/products',
      createInventoryDraft(),
    ).expect(201);

    const createdProduct = getInventoryProductFromResponse(createResponse);
    expect(createdProduct.identity.brand).toBe('CeraVe');
    expect(createdProduct.identity.imageUrls).toEqual([
      'https://cdn.example.com/product-images/processed/source.webp?signed=fresh',
    ]);

    const listResponse = await authGet('/inventory/products', {
      search: 'retinol',
    }).expect(200);
    const listedProducts = getInventoryListFromResponse(listResponse);
    expect(listedProducts.items).toHaveLength(1);
    expect(listedProducts.items[0].id).toBe(createdProduct.id);

    const getOneResponse = await authGet(
      `/inventory/products/${createdProduct.id}`,
    ).expect(200);
    const fetchedProduct = getInventoryProductFromResponse(getOneResponse);
    expect(fetchedProduct.id).toBe(createdProduct.id);
    expect(fetchedProduct.identity.name).toBe('Resurfacing Retinol Serum');
  });

  it('updates inventory products with normalized signed media urls', async () => {
    const createdProduct = getInventoryProductFromResponse(
      await authPost('/inventory/products', createInventoryDraft()).expect(201),
    );
    const updatePayload = createInventoryDraft({
      name: 'Renewing Night Serum',
      imageUrls: [
        'https://cdn.example.com/product-images/processed/updated.webp?Policy=temporary',
      ],
      description: 'An updated retinol serum description.',
      benefits: ['smoothing', 'brightening'],
      suitedFor: ['combination'],
      inciIngredients: ['Aqua', 'Niacinamide', 'Retinol'],
      openedAt: toUtcMidnightIso(-3),
      personalNotes: 'Use twice weekly.',
      pricePaid: 29.99,
      preferredTimeOfDay: PreferredTimeOfDay.Evening,
    });

    const updateResponse = await authPatch(
      `/inventory/products/${createdProduct.id}`,
      updatePayload,
    ).expect(200);
    const updatedProduct = getInventoryProductFromResponse(updateResponse);

    expect(updatedProduct.identity.name).toBe('Renewing Night Serum');
    expect(updatedProduct.identity.imageUrls).toEqual([
      'https://cdn.example.com/product-images/processed/updated.webp?signed=fresh',
    ]);
    expect(updatedProduct.identity.benefits).toEqual([
      'smoothing',
      'brightening',
    ]);
    expect(updatedProduct.userFields.personalNotes).toBe('Use twice weekly.');
    expect(updatedProduct.userFields.pricePaid).toBe(29.99);
  });

  it('returns stats and filtered lists for shelf states', async () => {
    await authPost(
      '/inventory/products',
      createInventoryDraft({
        name: 'Unopened Barrier Cream',
        category: ProductCategory.Moisturizer,
        openedAt: null,
        expiresAt: null,
      }),
    ).expect(201);

    const expiredProduct = getInventoryProductFromResponse(
      await authPost(
        '/inventory/products',
        createInventoryDraft({
          name: 'Expired Exfoliating Serum',
          openedAt: toUtcMidnightIso(-30),
          expiresAt: toUtcMidnightIso(-1),
        }),
      ).expect(201),
    );

    const archivedProduct = getInventoryProductFromResponse(
      await authPost(
        '/inventory/products',
        createInventoryDraft({
          name: 'Archive Candidate Toner',
          category: ProductCategory.Toner,
        }),
      ).expect(201),
    );

    await authPost(`/inventory/products/${archivedProduct.id}/archive`).expect(
      201,
    );

    const statsResponse = await authGetWithTimeZone(
      '/inventory/products/stats',
      'UTC',
    ).expect(200);
    const stats = getInventoryStatsFromResponse(statsResponse);

    expect(stats[ShelfStatFilter.All]).toBe(2);
    expect(stats[ShelfStatFilter.InUse]).toBe(1);
    expect(stats[ShelfStatFilter.Unopened]).toBe(1);
    expect(stats[ShelfStatFilter.Expired]).toBe(1);
    expect(stats[ShelfStatFilter.NearingExpiry]).toBe(1);
    expect(stats[ShelfStatFilter.Archived]).toBe(1);

    const expiredList = getInventoryListFromResponse(
      await authGetWithTimeZone('/inventory/products', 'UTC', {
        stat: ShelfStatFilter.Expired,
      }).expect(200),
    );
    expect(expiredList.items).toHaveLength(1);
    expect(expiredList.items[0].id).toBe(expiredProduct.id);

    const archivedList = getInventoryListFromResponse(
      await authGet('/inventory/products', {
        stat: ShelfStatFilter.Archived,
      }).expect(200),
    );
    expect(archivedList.items).toHaveLength(1);
    expect(archivedList.items[0].id).toBe(archivedProduct.id);
  });

  it('supports status transitions, bulk actions, and deletion', async () => {
    const productOne = getInventoryProductFromResponse(
      await authPost(
        '/inventory/products',
        createInventoryDraft({ name: 'Status Test Serum A' }),
      ).expect(201),
    );
    const productTwo = getInventoryProductFromResponse(
      await authPost(
        '/inventory/products',
        createInventoryDraft({ name: 'Status Test Serum B' }),
      ).expect(201),
    );
    const productThree = getInventoryProductFromResponse(
      await authPost(
        '/inventory/products',
        createInventoryDraft({ name: 'Status Test Serum C' }),
      ).expect(201),
    );

    const archived = getInventoryProductFromResponse(
      await authPost(`/inventory/products/${productOne.id}/archive`).expect(
        201,
      ),
    );
    expect(archived.status).toBe(ShelfStatus.Archived);

    const restored = getInventoryProductFromResponse(
      await authPost(`/inventory/products/${productOne.id}/restore`).expect(
        201,
      ),
    );
    expect(restored.status).toBe(ShelfStatus.Active);

    const finished = getInventoryProductFromResponse(
      await authPost(
        `/inventory/products/${productOne.id}/mark-finished`,
      ).expect(201),
    );
    expect(finished.status).toBe(ShelfStatus.FinishedUp);

    await authPost('/inventory/products/bulk/archive', {
      ids: [productTwo.id, productThree.id],
    }).expect(200);
    let archivedList = getInventoryListFromResponse(
      await authGet('/inventory/products', {
        stat: ShelfStatFilter.Archived,
      }).expect(200),
    );
    expect(archivedList.items.map((item) => item.id).sort()).toEqual(
      [productTwo.id, productThree.id].sort(),
    );

    await authPost('/inventory/products/bulk/restore', {
      ids: [productTwo.id, productThree.id],
    }).expect(200);
    await authPost('/inventory/products/bulk/mark-finished', {
      ids: [productTwo.id, productThree.id],
    }).expect(200);

    const allProducts = getInventoryListFromResponse(
      await authGet('/inventory/products').expect(200),
    );
    expect(
      allProducts.items.filter(
        (item) => item.status === ShelfStatus.FinishedUp,
      ),
    ).toHaveLength(3);

    await authPost('/inventory/products/bulk-delete', {
      ids: [productTwo.id, productThree.id],
    }).expect(200);
    await authDelete(`/inventory/products/${productOne.id}`).expect(204);
    await authGet(`/inventory/products/${productOne.id}`).expect(404);

    archivedList = getInventoryListFromResponse(
      await authGet('/inventory/products').expect(200),
    );
    expect(archivedList.items).toHaveLength(0);
  });

  it('uploads product images through the multipart endpoint', async () => {
    const uploadResponse = await request(app.getHttpServer())
      .post('/api/v1/inventory/products/upload-image')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach(
        CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD,
        Buffer.from('fake-image-data'),
        'product.jpg',
      )
      .expect(201);

    const body = getUploadImageResponse(uploadResponse);
    expect(body.imageUrl).toBe(
      'https://cdn.example.com/product-images/processed/uploaded-image.webp?signed=upload',
    );
    expect(
      cataloguePhotoProcessorService.prepareHeroImageForStorage,
    ).toHaveBeenCalled();
    expect(cataloguePhotoStorageService.saveHeroImage).toHaveBeenCalled();
  });

  it('creates inventory products with an image only during final save', async () => {
    const uploadResponse = await request(app.getHttpServer())
      .post('/api/v1/inventory/products/with-image')
      .set('Authorization', `Bearer ${accessToken}`)
      .field(
        CATALOGUE_PRODUCT_DRAFT_UPLOAD_FIELD,
        JSON.stringify(createInventoryDraft({ imageUrls: [] })),
      )
      .attach(
        CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD,
        Buffer.from('fake-image-data'),
        'product.jpg',
      )
      .expect(201);
    const createdProduct = getInventoryProductFromResponse(uploadResponse);

    expect(createdProduct.identity.imageUrls).toEqual([
      'https://cdn.example.com/product-images/processed/uploaded-image.webp?signed=fresh',
    ]);
    expect(
      cataloguePhotoProcessorService.prepareHeroImageForStorage,
    ).toHaveBeenCalled();
    expect(
      cataloguePhotoStorageService.startHeroImageUpload,
    ).toHaveBeenCalled();
  });

  it('uploads and attaches product images to existing products', async () => {
    const createdProduct = getInventoryProductFromResponse(
      await authPost('/inventory/products', createInventoryDraft()).expect(201),
    );

    const uploadResponse = await request(app.getHttpServer())
      .post(`/api/v1/inventory/products/${createdProduct.id}/upload-image`)
      .set('Authorization', `Bearer ${accessToken}`)
      .attach(
        CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD,
        Buffer.from('fake-image-data'),
        'product.jpg',
      )
      .expect(201);
    const updatedProduct = getInventoryProductFromResponse(uploadResponse);

    expect(updatedProduct.identity.imageUrls).toEqual([
      'https://cdn.example.com/product-images/processed/uploaded-image.webp?signed=fresh',
    ]);

    const fetchedProduct = getInventoryProductFromResponse(
      await authGet(`/inventory/products/${createdProduct.id}`).expect(200),
    );
    expect(fetchedProduct.identity.imageUrls).toEqual([
      'https://cdn.example.com/product-images/processed/uploaded-image.webp?signed=fresh',
    ]);
  });
});
