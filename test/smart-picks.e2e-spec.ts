import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ENVIRONMENT_PROVIDER } from '../src/environment-intelligence/environment-provider.interface';
import { EnvironmentProviderName } from '../src/environment-intelligence/environment-intelligence.constants';
import { MailService } from '../src/mail/mail.service';
import { SuggestionEvidenceSourceId } from '../src/suggestions/suggestions.constants';
import {
  GeneratedSmartPick,
  SmartPicksAiGenerator,
} from '../src/smart-picks/services/smart-picks-ai-generator';
import { SmartPicksGenerationWorkerModule } from '../src/smart-picks/smart-picks-generation-worker.module';
import { SmartPicksGenerationWorker } from '../src/smart-picks/services/smart-picks-generation-worker.service';
import { SmartPicksOverviewService } from '../src/smart-picks/services/smart-picks-overview.service';
import { SmartPicksPreparationService } from '../src/smart-picks/services/smart-picks-preparation.service';
import type { SmartPicksGapSnapshot } from '../src/smart-picks/smart-picks.types';
import {
  createCompletedSkinProfile,
  createTestApp,
  createTestInventoryProduct,
  MockMailService,
  truncateTables,
} from './test-setup';

const ORIGIN = 'http://localhost:3000';
const SMART_PICK_POLL_ATTEMPTS = 20;
const SMART_PICK_POLL_DELAY_MS = 25;
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
  productGeneration: {
    status: 'ready' | 'pending' | 'failed' | 'skipped';
    reason: 'provider_failed' | 'missing_api_key' | 'no_pick' | null;
    missingPickCount: number;
    isProcessing: boolean;
    attemptedAt: string | null;
    retryAfter: string | null;
  };
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
  let workerModule: TestingModule;
  let mockMail: MockMailService;
  let accessToken: string;
  let smartPicksPreparation: SmartPicksPreparationService;
  let smartPicksOverview: SmartPicksOverviewService;
  let smartPicksGenerationWorker: SmartPicksGenerationWorker;

  const aiGenerator = {
    generateWithDiagnostics: jest.fn(
      async (_context: unknown, gaps: SmartPicksGapSnapshot[]) => {
        const picks = new Map<string, GeneratedSmartPick>();
        const targetGap = gaps[0];
        if (targetGap) {
          picks.set(
            targetGap.normalizedKey,
            generatedPick({
              productName: `${targetGap.ingredientOrCategory} Pick`,
            }),
          );
        }
        return {
          picks,
          diagnostics: {
            requestedGapCount: gaps.length,
            rawGapCount: picks.size,
            acceptedPickCount: picks.size,
            blockedOwnedCount: 0,
            blockedBudgetCount: 0,
            blockedSafetyCount: 0,
            invalidPickCount: 0,
            missingPickCount: Math.max(0, gaps.length - picks.size),
            providerFailed: false,
            providerSkippedReason: null,
          },
        };
      },
    ),
    assessStarterTreatment: jest.fn().mockResolvedValue(null),
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
    smartPicksPreparation = app.get(SmartPicksPreparationService);
    smartPicksOverview = app.get(SmartPicksOverviewService);
    workerModule = await Test.createTestingModule({
      imports: [SmartPicksGenerationWorkerModule],
    })
      .overrideProvider(SmartPicksAiGenerator)
      .useValue(aiGenerator)
      .overrideProvider(ENVIRONMENT_PROVIDER)
      .useValue(environmentProvider)
      .overrideProvider(MailService)
      .useValue(mockMail)
      .compile();
    await workerModule.init();
    smartPicksGenerationWorker = workerModule.get(SmartPicksGenerationWorker);

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
    await smartPicksPreparation.waitForIdle();
  });

  afterAll(async () => {
    await workerModule.close();
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
    await smartPicksPreparation.waitForIdle();
    aiGenerator.generateWithDiagnostics.mockClear();

    const response = await authGet('/smart-picks/overview').expect(200);
    const overview = response.body as SmartPicksOverviewResponse;

    expect(overview.consentRequired).toBe(true);
    expect(overview.priorityGaps).toEqual([]);
    expect(aiGenerator.generateWithDiagnostics).not.toHaveBeenCalled();

    await authPatch('/skin-profile', { allowSmartPicks: true }).expect(200);
    await smartPicksPreparation.waitForIdle();
    aiGenerator.generateWithDiagnostics.mockClear();
  });

  it('generates overview picks, saves them through gap actions, and removes them from wishlist', async () => {
    const firstOverview = (
      await authGet('/smart-picks/overview?mode=refine').expect(200)
    ).body as SmartPicksOverviewResponse;
    const targetGapKey = firstOverview.priorityGaps[0]?.normalizedKey;
    if (!targetGapKey) {
      throw new Error('Expected at least one Smart Picks priority gap.');
    }
    expect(firstOverview.productGeneration.status).toBe('pending');
    expect(firstOverview.productGeneration.isProcessing).toBe(true);
    await smartPicksGenerationWorker.pollOnce();
    await smartPicksOverview.waitForBackgroundGeneration();
    const overview = await readOverviewWithPick(targetGapKey);
    const pickedGap = overview.priorityGaps.find(
      (gap) => gap.normalizedKey === targetGapKey,
    );
    const productName = pickedGap?.pick?.productName;
    if (!productName) {
      throw new Error('Expected the Smart Picks gap to have a product pick.');
    }
    expect(pickedGap?.pick).toEqual(expect.objectContaining({ productName }));

    await authPost('/suggestions/gap-actions', {
      sourceType: 'smart_pick',
      smartPickProductSuggestionId: pickedGap?.pick?.id,
      action: 'saved',
    }).expect(200);

    const wishlistResponse = await authGet('/smart-picks/wishlist').expect(200);
    const wishlist = wishlistResponse.body as SmartPicksWishlistResponse;
    expect(wishlist.items[0]).toEqual(
      expect.objectContaining({
        normalizedKey: targetGapKey,
        pick: expect.objectContaining({
          productName,
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

  async function readOverviewWithPick(
    normalizedKey: string,
  ): Promise<SmartPicksOverviewResponse> {
    for (let attempt = 0; attempt < SMART_PICK_POLL_ATTEMPTS; attempt += 1) {
      const response = await authGet(
        '/smart-picks/overview?mode=refine',
      ).expect(200);
      const overview = response.body as SmartPicksOverviewResponse;
      const matchingGap = overview.priorityGaps.find(
        (gap) => gap.normalizedKey === normalizedKey,
      );
      if (matchingGap?.pick) return overview;
      if (overview.productGeneration.status === 'pending') {
        await smartPicksGenerationWorker.pollOnce();
      }
      await delay(SMART_PICK_POLL_DELAY_MS);
    }

    const response = await authGet('/smart-picks/overview?mode=refine').expect(
      200,
    );
    return response.body as SmartPicksOverviewResponse;
  }
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function generatedPick(
  overrides: Partial<GeneratedSmartPick> = {},
): GeneratedSmartPick {
  return {
    brand: 'Good Brand',
    productName: 'Mineral SPF 50',
    budgetTier: 'mid',
    sellerNames: ['Derm Store'],
    reasoningChips: [
      { tone: 'ethnicity', text: 'white-cast checked', icon: 'check' },
    ],
    reasoningFacts: { fit: 'Supports daily sun protection.' },
    ruledOut: [
      {
        brand: 'Too Much',
        productName: 'Luxury SPF',
        reason: 'Outside budget.',
      },
    ],
    sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    alternatives: [],
    recommendationRankReason: 'Best budget-matched daily SPF fit.',
    ...overrides,
  };
}
