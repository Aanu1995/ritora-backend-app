import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ENVIRONMENT_PROVIDER } from '../src/environment-intelligence/environment-provider.interface';
import { EnvironmentProviderName } from '../src/environment-intelligence/environment-intelligence.constants';
import { SuggestionEvidenceSourceId } from '../src/suggestions/suggestions.constants';
import {
  GeneratedSmartPick,
  SmartPicksAiGenerator,
} from '../src/smart-picks/services/smart-picks-ai-generator';
import {
  createCompletedSkinProfile,
  createTestApp,
  createTestInventoryProduct,
  MockMailService,
  truncateTables,
} from './test-setup';

const ORIGIN = 'http://localhost:3000';
const TEST_USER = {
  email: 'smart-picks@example.com',
  password: 'TestPass1',
  firstName: 'Smart',
  lastName: 'Picks',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

type SmartPicksOverviewResponse = {
  consentRequired: boolean;
  skinProfileRequired: boolean;
  productSuggestionsUnavailable: boolean;
  priorityGaps: Array<{
    normalizedKey: string;
    ingredientOrCategory: string;
    pick: { id: string; productName: string; userAction: string | null } | null;
  }>;
  recap: { budgetTier: string | null };
};

type SmartPicksWishlistResponse = {
  items: Array<{
    actionId: string;
    normalizedKey: string;
    pick: { id: string; productName: string; userAction: string | null };
  }>;
};

describe('Smart Picks (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;
  let accessToken: string;

  const aiGenerator = {
    generate: jest.fn(async () => {
      const picks = new Map<string, GeneratedSmartPick>();
      picks.set('broad-spectrum-sunscreen-spf-30', generatedPick());
      return picks;
    }),
  };
  const environmentProvider = {
    resolveLocation: jest.fn().mockResolvedValue({
      provider: EnvironmentProviderName.OpenMeteo,
      providerLocationId: 'test-stockholm',
      label: 'Stockholm, Sweden',
      latitude: 59.33,
      longitude: 18.06,
      timeZone: 'Europe/Stockholm',
      confidence: 0.9,
    }),
    fetchSnapshot: jest.fn().mockResolvedValue({
      provider: EnvironmentProviderName.OpenMeteo,
      fetchedAt: '2026-05-10T06:00:00.000Z',
      temperatureCelsius: 15,
      humidity: 45,
      uvIndex: 4,
      airQualityIndex: 24,
      pm25: 6,
      pm10: 12,
      pollenRisk: null,
      conditionLabel: 'Cloudy',
      seasonalTrend: {
        humidityDropping: false,
        uvRising: false,
      },
    }),
  };

  beforeAll(async () => {
    mockMail = new MockMailService();
    app = await createTestApp(mockMail, [
      { provider: SmartPicksAiGenerator, useValue: aiGenerator },
      { provider: ENVIRONMENT_PROVIDER, useValue: environmentProvider },
    ]);

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
      .send({ email: TEST_USER.email, password: TEST_USER.password })
      .expect(200);
    accessToken = loginResponse.body.accessToken as string;

    await createCompletedSkinProfile(app, accessToken);
    await createTestInventoryProduct(app, accessToken);
  });

  afterAll(async () => {
    await truncateTables(app);
    await app.close();
  });

  it('requires authentication for Smart Picks endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/smart-picks/overview')
      .expect(401);
  });

  it('returns a consent-gated overview without calling the AI generator', async () => {
    await authPatch('/skin-profile', { allowSmartPicks: false }).expect(200);
    aiGenerator.generate.mockClear();

    const response = await authGet('/smart-picks/overview').expect(200);
    const overview = response.body as SmartPicksOverviewResponse;

    expect(overview.consentRequired).toBe(true);
    expect(overview.priorityGaps).toEqual([]);
    expect(aiGenerator.generate).not.toHaveBeenCalled();

    await authPatch('/skin-profile', { allowSmartPicks: true }).expect(200);
  });

  it('generates overview picks, saves them through gap actions, and removes them from wishlist', async () => {
    const response = await authGet('/smart-picks/overview?mode=refine').expect(
      200,
    );
    const overview = response.body as SmartPicksOverviewResponse;
    const sunscreenGap = overview.priorityGaps.find(
      (gap) => gap.normalizedKey === 'broad-spectrum-sunscreen-spf-30',
    );
    expect(sunscreenGap?.pick).toEqual(
      expect.objectContaining({ productName: 'Mineral SPF 50' }),
    );

    await authPost('/suggestions/gap-actions', {
      sourceType: 'smart_pick',
      smartPickProductSuggestionId: sunscreenGap?.pick?.id,
      action: 'saved',
    }).expect(200);

    const wishlistResponse = await authGet('/smart-picks/wishlist').expect(200);
    const wishlist = wishlistResponse.body as SmartPicksWishlistResponse;
    expect(wishlist.items[0]).toEqual(
      expect.objectContaining({
        normalizedKey: 'broad-spectrum-sunscreen-spf-30',
        pick: expect.objectContaining({
          productName: 'Mineral SPF 50',
          userAction: 'saved',
        }),
      }),
    );

    await authDelete(
      `/smart-picks/wishlist/${wishlist.items[0]?.actionId}`,
    ).expect(204);

    const emptyWishlist = (await authGet('/smart-picks/wishlist').expect(200))
      .body as SmartPicksWishlistResponse;
    expect(emptyWishlist.items).toEqual([]);
  });

  it('rejects unsupported budget tiers', async () => {
    await authPatch('/smart-picks/budget', { budgetTier: 'starter' }).expect(
      400,
    );
  });

  function authGet(path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  function authPost(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN)
      .send(body);
  }

  function authPatch(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN)
      .send(body);
  }

  function authDelete(path: string) {
    return request(app.getHttpServer())
      .delete(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN);
  }
});

function generatedPick(): GeneratedSmartPick {
  return {
    brand: 'Good Brand',
    productName: 'Mineral SPF 50',
    budgetTier: 'mid',
    priceCents: 2200,
    currency: 'USD',
    retailers: [
      {
        name: 'Derm Store',
        url: 'https://example.com/spf',
        priceCents: 2200,
        currency: 'USD',
        inStock: true,
        isAffiliate: true,
      },
    ],
    reasoningChips: [
      { tone: 'ethnicity', text: 'white-cast checked', icon: 'check' },
    ],
    reasoningFacts: { fit: 'Supports daily sun protection.' },
    ruledOut: [
      {
        brand: 'Too Much',
        productName: 'Luxury SPF',
        priceCents: 9000,
        currency: 'USD',
        reason: 'Outside budget.',
      },
    ],
    sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    alternatives: [],
    verificationStatus: 'ai_named',
    availabilityStatus: 'local',
    recommendationRankReason: 'Best budget-matched daily SPF fit.',
    localAlternativeReason: null,
  };
}
