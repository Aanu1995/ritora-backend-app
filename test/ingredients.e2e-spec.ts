import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  type IngredientClassification,
  type IngredientClassifierPort,
  INGREDIENT_CLASSIFIER_PORT,
} from '../src/ingredients/ingredient-classifier.port';
import {
  AnalysisSeverity,
  IngredientCategory,
} from '../src/ingredients/ingredients.types';
import {
  ApplicationMethod,
  DataProvenance,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfStatus,
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
  email: 'ingredients@example.com',
  password: 'TestPass1',
  firstName: 'Ingredients',
  lastName: 'Test',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

const ingredientClassifier: IngredientClassifierPort = {
  classify: async ({ tokens }) =>
    tokens
      .map((token) => classifyIngredientForE2e(token))
      .filter(
        (classification): classification is IngredientClassification =>
          classification !== null,
      ),
};

function getAccessTokenFromResponse(res: request.Response): string {
  const body = res.body as { accessToken?: unknown };

  if (typeof body.accessToken !== 'string') {
    throw new Error('Auth response did not include a string accessToken');
  }

  return body.accessToken;
}

function createInventoryDraft(overrides?: {
  brand?: string;
  name?: string;
  category?: ProductCategory;
  inciIngredients?: string[];
  openedAt?: string | null;
}) {
  const brand = overrides?.brand ?? 'Ritora';
  const name = overrides?.name ?? 'Test Product';

  return {
    identity: {
      brand,
      name,
      category: overrides?.category ?? ProductCategory.Serum,
      barcode: null,
      imageUrls: ['https://cdn.example.com/product-images/product.webp'],
      sizeMl: 30,
      description: 'Test description',
      benefits: ['support'],
      suitedFor: ['all'],
      inciIngredients: overrides?.inciIngredients ?? ['Water', 'Glycerin'],
      inciLastConfirmedAt: new Date().toISOString(),
    },
    guidance: {
      applicationMethod: ApplicationMethod.Fingertips,
      quantity: Quantity.PeaSize,
      steps: ['Apply to clean skin.'],
      cautions: [],
      waitMinutes: 1,
    },
    manufacturer: {
      brand,
      parentCompany: null,
      countryOfOrigin: 'SE',
      countryOfManufacture: 'SE',
      supportEmail: 'support@example.com',
      productUrl: 'https://example.com/products/test',
      websiteUrl: 'https://example.com',
    },
    userFields: {
      openedAt: overrides?.openedAt ?? new Date().toISOString(),
      expiresAt: null,
      periodAfterOpeningMonths: 12,
      pricePaid: 20,
      pricePaidCurrency: 'USD',
      purchasedFrom: 'Test',
      personalNotes: null,
      preferredTimeOfDay: PreferredTimeOfDay.Evening,
    },
    status: ShelfStatus.Active,
    provenance: DataProvenance.PhotoLookup,
  };
}

function classifyIngredientForE2e(
  token: string,
): IngredientClassification | null {
  const normalized = token.trim().toLowerCase();
  const base = {
    rawToken: token,
    canonicalName: token,
    confidence: 0.8,
    summaryEn: `${token} classified for e2e analysis.`,
    phSensitive: false,
    photosensitizing: false,
    requiresSpf: false,
    irritationRisk: false,
    overlapSeverity: AnalysisSeverity.Low,
  };

  if (normalized === 'retinol') {
    return {
      ...base,
      category: IngredientCategory.Retinoid,
      photosensitizing: true,
      requiresSpf: true,
      irritationRisk: true,
      overlapSeverity: AnalysisSeverity.High,
    };
  }
  if (normalized === 'glycolic acid') {
    return {
      ...base,
      category: IngredientCategory.Aha,
      photosensitizing: true,
      requiresSpf: true,
      irritationRisk: true,
      overlapSeverity: AnalysisSeverity.High,
    };
  }
  if (normalized === 'salicylic acid') {
    return {
      ...base,
      category: IngredientCategory.Bha,
      irritationRisk: true,
      overlapSeverity: AnalysisSeverity.High,
    };
  }
  if (normalized === 'niacinamide') {
    return {
      ...base,
      category: IngredientCategory.Niacinamide,
    };
  }

  return null;
}

describe('Ingredients (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;
  let accessToken: string;
  let retinolId: string;
  let glycolicId: string;
  let salicylicId: string;

  beforeAll(async () => {
    mockMail = new MockMailService();
    app = await createTestApp(mockMail, [
      {
        provider: INGREDIENT_CLASSIFIER_PORT,
        useValue: ingredientClassifier,
      },
    ]);
  });

  beforeEach(async () => {
    await truncateTables(app);
    mockMail.clear();

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

    const retinolRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/products')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(
        createInventoryDraft({
          brand: 'CeraVe',
          name: 'Retinol Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Water', 'Retinol', 'Niacinamide'],
        }),
      )
      .expect(201);
    retinolId = (retinolRes.body as { id: string }).id;

    const glycolicRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/products')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(
        createInventoryDraft({
          brand: 'Pixi',
          name: 'Glow Tonic',
          category: ProductCategory.Toner,
          inciIngredients: ['Water', 'Glycolic Acid'],
        }),
      )
      .expect(201);
    glycolicId = (glycolicRes.body as { id: string }).id;

    const salicylicRes = await request(app.getHttpServer())
      .post('/api/v1/inventory/products')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(
        createInventoryDraft({
          brand: "Paula's Choice",
          name: 'BHA Liquid',
          category: ProductCategory.Exfoliant,
          inciIngredients: ['Water', 'Salicylic Acid'],
        }),
      )
      .expect(201);
    salicylicId = (salicylicRes.body as { id: string }).id;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('returns educational actives in focus mode', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ingredients/analyze')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        focusProductId: retinolId,
        withExplanations: false,
      })
      .expect(200);

    expect(res.body).toMatchObject({
      mode: 'focus',
      status: 'ok',
      engineVersion: expect.any(String),
    });
    expect(res.body.conflicts).toEqual([]);
    expect(res.body.overlaps).toEqual([]);
    expect(res.body.actives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'retinol',
          displayName: 'Retinol',
          category: 'retinoid',
          summary: expect.any(String),
          avoidCategories: expect.arrayContaining(['aha', 'bha']),
          avoidIngredients: [],
        }),
      ]),
    );
  });

  it('supports explicit product-id analysis requests', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ingredients/analyze')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        productIds: [retinolId, salicylicId],
        withExplanations: false,
      })
      .expect(200);

    expect(res.body).toMatchObject({
      mode: 'multi',
      status: 'ok',
      engineVersion: expect.any(String),
    });
    expect(res.body.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RETINOID_BHA',
          productAId: retinolId,
          productBId: salicylicId,
        }),
      ]),
    );
    expect(res.body.overlaps).toEqual([]);
    expect(res.body.layeringOrder).toHaveLength(2);
  });

  it('rejects analysis requests that provide both modes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ingredients/analyze')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        focusProductId: retinolId,
        productIds: [retinolId, glycolicId],
      })
      .expect(400);
  });

  it('rejects analysis requests that provide neither mode', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ingredients/analyze')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        withExplanations: false,
      })
      .expect(400);
  });

  it('rejects analysis requests with more than 30 product ids', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ingredients/analyze')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        productIds: Array.from(
          { length: 31 },
          (_, index) => `01HWXYZ${String(index).padStart(19, '0')}`,
        ),
      })
      .expect(400);
  });

  it('compares a checked product with Shelf and flags replacement-only overlap', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/ingredients/compare-products')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        anchor: {
          kind: 'checked_product',
          product: {
            source: 'ingredient_paste',
            brand: 'New Lab',
            name: 'Retinol Serum',
            category: ProductCategory.Serum,
            inciIngredients: ['Water', 'Retinol', 'Niacinamide'],
          },
        },
        candidates: [
          {
            kind: 'shelf_product',
            productId: retinolId,
          },
        ],
      })
      .expect(200);

    expect(res.body).toMatchObject({
      comparison: {
        outcome: 'no_clear_winner',
        winnerItemId: null,
      },
    });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.comparison.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'already_owned' }),
        expect.objectContaining({ code: 'replacement_only' }),
      ]),
    );
  });

  it('rejects compare requests for Shelf products owned by another user', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/ingredients/compare-products')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        anchor: {
          kind: 'shelf_product',
          productId: retinolId,
        },
        candidates: [
          {
            kind: 'shelf_product',
            productId: '01KCOMPAREMISSING00000001',
          },
        ],
      })
      .expect(404);
  });
});
