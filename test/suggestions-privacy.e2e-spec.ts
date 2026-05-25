import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ENVIRONMENT_PROVIDER } from '../src/environment-intelligence/environment-provider.interface';
import { EnvironmentProviderName } from '../src/environment-intelligence/environment-intelligence.constants';
import { ProductCategory } from '../src/shelf/shelf.types';
import { SuggestionGenerationJob } from '../src/suggestions/entities/suggestion-generation-job.entity';
import {
  SuggestionEvidenceSourceId,
  SuggestionGenerationStatus,
  SuggestionMode,
  SuggestionRequestSource,
  SuggestionStepProvenance,
} from '../src/suggestions/suggestions.constants';
import {
  SuggestionAiGenerator,
  SuggestionGenerationInputs,
  SuggestionGenerationOutput,
} from '../src/suggestions/services/suggestion-ai-generator';
import { SuggestionGenerationService } from '../src/suggestions/services/suggestion-generation.service';
import { SuggestionRetentionService } from '../src/suggestions/services/suggestion-retention.service';
import {
  closeTestApp,
  createCompletedSkinProfile,
  createTestApp,
  createTestInventoryProduct,
  MockMailService,
} from './test-setup';

const ORIGIN = 'http://localhost:3000';
const TEST_USER = {
  email: 'suggestions-privacy@example.com',
  password: 'TestPass1',
  firstName: 'Suggestions',
  lastName: 'Privacy',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

type SensitiveSuggestionRow = {
  ai_error: unknown;
  ai_explanation: unknown;
  gap_recommendations: unknown;
  generation_context: unknown;
  request_context: unknown;
  safety_flags: unknown;
};

describe('Suggestions privacy and retention (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  const aiGenerator = {
    generate: jest.fn((inputs: SuggestionGenerationInputs) =>
      buildOutput(inputs),
    ),
  };
  const environmentProvider = {
    resolveLocation: jest.fn().mockResolvedValue({
      provider: EnvironmentProviderName.OpenMeteo,
      providerLocationId: 'privacy-stockholm',
      label: 'Stockholm, Sweden',
      latitude: 59.33,
      longitude: 18.06,
      timeZone: 'Europe/Stockholm',
      confidence: 0.9,
    }),
    fetchSnapshot: jest.fn().mockResolvedValue({
      provider: EnvironmentProviderName.OpenMeteo,
      fetchedAt: '2026-05-06T06:00:00.000Z',
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
    const mockMail = new MockMailService();
    app = await createTestApp(mockMail, [
      { provider: SuggestionAiGenerator, useValue: aiGenerator },
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
    await authPost('/suggestions/ai-consent', { granted: true }).expect(200);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('blocks on-demand suggestions before queuing context work when AI consent is missing', async () => {
    const dataSource = app.get(DataSource);
    const userId = await loadCurrentUserId(dataSource);
    await authPost('/suggestions/ai-consent', { granted: false }).expect(200);
    const suggestionCountBefore = await countOnDemandSuggestions(
      dataSource,
      userId,
    );
    const jobCountBefore = await countOnDemandJobs(dataSource, userId);
    const callsBefore = aiGenerator.generate.mock.calls.length;

    try {
      const response = await authPost('/suggestions/on-demand', {
        intent: 'quick_refresh',
        intensity: 'minimal',
        note: 'Private flare note should not enter prompt work.',
        requestId: 'privacy-no-consent',
      }).expect(403);

      expect(response.body.message).toBe(
        'AI suggestion consent is required before requesting a quick suggestion.',
      );
      expect(await countOnDemandSuggestions(dataSource, userId)).toBe(
        suggestionCountBefore,
      );
      expect(await countOnDemandJobs(dataSource, userId)).toBe(jobCountBefore);
      expect(aiGenerator.generate).toHaveBeenCalledTimes(callsBefore);
      expect(
        await countObservabilityEvents(dataSource, userId, 'consent_degraded'),
      ).toBeGreaterThan(0);
    } finally {
      await authPost('/suggestions/ai-consent', { granted: true }).expect(200);
    }
  });

  it('clears stored AI prompt and context fields during user-scoped suggestion purge', async () => {
    const dataSource = app.get(DataSource);
    const userId = await loadCurrentUserId(dataSource);
    const createResponse = await authPost('/suggestions/on-demand', {
      intent: 'quick_refresh',
      intensity: 'minimal',
      note: 'User-owned note stored only until retention purge.',
      requestId: 'privacy-retention-purge',
    }).expect(202);
    const created = createResponse.body as {
      id: string;
      generationStatus: string;
      requestSource: string;
    };
    expect(created.requestSource).toBe(SuggestionRequestSource.OnDemand);
    expect(created.generationStatus).toBe(
      SuggestionGenerationStatus.Generating,
    );

    await generateQueuedSuggestion(created.id);
    await dataSource.query(
      'UPDATE suggestion_instances SET ai_error = $2 WHERE id = $1',
      [created.id, 'privacy-sensitive-provider-error'],
    );
    const beforePurge = await loadSensitiveSuggestionRow(
      dataSource,
      created.id,
    );
    expect(beforePurge).toEqual(
      expect.objectContaining({
        ai_error: 'privacy-sensitive-provider-error',
        ai_explanation: expect.anything(),
        gap_recommendations: expect.anything(),
        generation_context: expect.anything(),
        request_context: expect.anything(),
        safety_flags: expect.anything(),
      }),
    );

    const purgeResult = await app
      .get(SuggestionRetentionService)
      .purgeUserSuggestionData(userId);
    const afterPurge = await loadSensitiveSuggestionRow(dataSource, created.id);

    expect(purgeResult.suggestionFieldsCleared).toBeGreaterThanOrEqual(1);
    expect(afterPurge).toEqual({
      ai_error: null,
      ai_explanation: null,
      gap_recommendations: null,
      generation_context: null,
      request_context: null,
      safety_flags: null,
    });
    expect(
      await countObservabilityEvents(dataSource, userId, 'retention_purged'),
    ).toBeGreaterThan(0);
  });

  function authPost(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN)
      .set('X-Timezone', 'Europe/Stockholm')
      .send(body);
  }

  async function generateQueuedSuggestion(suggestionId: string): Promise<void> {
    const dataSource = app.get(DataSource);
    const job = await dataSource
      .getRepository(SuggestionGenerationJob)
      .findOne({
        where: { suggestion_instance_id: suggestionId },
      });
    if (!job) {
      throw new Error('Queued on-demand job not found.');
    }
    await app.get(SuggestionGenerationService).generateForJob(job);
  }
});

function buildOutput(
  inputs: SuggestionGenerationInputs,
): SuggestionGenerationOutput {
  const product = inputs.shelfActiveProducts[0];
  if (!product) {
    throw new Error('Expected active product for privacy e2e output.');
  }
  return {
    mode: SuggestionMode.Ai,
    hasReactionSignal: false,
    simplifiedForReaction: false,
    explanation: {
      headline: 'Simple routine ready',
      body: ['Use the owned moisturizer and keep the routine calm today.'],
      perStepReasons: [
        {
          stepOrder: 0,
          reason: 'It matches the current shelf and gentle routine context.',
        },
      ],
      skipped: [],
      inputs: [{ label: 'History', detail: 'Recent context was considered.' }],
    },
    gapRecommendations: [
      {
        ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
        reason: 'Sunscreen supports pigment and daytime protection goals.',
        budgetTier: 'mid',
        goalAlignment: 'dark marks',
        sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
      },
    ],
    safetyFlags: [
      {
        severity: 'info',
        message: 'Stop and simplify if irritation appears.',
        ingredientSlugs: [],
        sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
      },
    ],
    steps: [
      {
        stepOrder: 0,
        routineStepId: null,
        inventoryProductId: product.id,
        productBrand: product.brand,
        productName: product.name,
        stepLabel: ProductCategory.Moisturizer,
        customLabel: null,
        applicationMethod: null,
        quantity: null,
        waitAfterMinutes: null,
        explanation: 'Apply a thin, even layer.',
        routineNote: null,
        provenance: SuggestionStepProvenance.AiAdded,
        chips: [],
        safetyWarnings: [],
      },
    ],
    metadata: {
      model: 'privacy-e2e-model',
      promptVersion: 'privacy-e2e',
      provider: 'openai',
      fallbackReason: null,
      inputTokens: 100,
      outputTokens: 80,
      totalTokens: 180,
      estimatedCostUsd: 0.001,
      durationMs: 25,
    },
  };
}

async function loadCurrentUserId(dataSource: DataSource): Promise<string> {
  const rows = await dataSource.query(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [TEST_USER.email],
  );
  const id = rows[0]?.id;
  if (typeof id !== 'string') {
    throw new Error('Could not resolve privacy e2e user id.');
  }
  return id;
}

async function countOnDemandSuggestions(
  dataSource: DataSource,
  userId: string,
): Promise<number> {
  return countRows(
    dataSource,
    `
      SELECT COUNT(*) AS count
      FROM suggestion_instances
      WHERE user_id = $1 AND request_source = 'on_demand'
    `,
    [userId],
  );
}

async function countOnDemandJobs(
  dataSource: DataSource,
  userId: string,
): Promise<number> {
  return countRows(
    dataSource,
    `
      SELECT COUNT(*) AS count
      FROM suggestion_generation_jobs
      WHERE user_id = $1 AND request_source = 'on_demand'
    `,
    [userId],
  );
}

async function countObservabilityEvents(
  dataSource: DataSource,
  userId: string,
  kind: string,
): Promise<number> {
  return countRows(
    dataSource,
    `
      SELECT COUNT(*) AS count
      FROM suggestion_observability_events
      WHERE user_id = $1 AND kind = $2
    `,
    [userId, kind],
  );
}

async function countRows(
  dataSource: DataSource,
  sql: string,
  parameters: readonly unknown[],
): Promise<number> {
  const rows = await dataSource.query(sql, [...parameters]);
  return Number(rows[0]?.count ?? 0);
}

async function loadSensitiveSuggestionRow(
  dataSource: DataSource,
  suggestionId: string,
): Promise<SensitiveSuggestionRow> {
  const rows = await dataSource.query(
    `
      SELECT ai_error, ai_explanation, gap_recommendations, generation_context,
        request_context, safety_flags
      FROM suggestion_instances
      WHERE id = $1
      LIMIT 1
    `,
    [suggestionId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('Expected suggestion row for retention verification.');
  }
  return row;
}
