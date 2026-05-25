import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource, EntityManager } from 'typeorm';
import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../src/application-tracking/application-tracking.constants';
import { ENVIRONMENT_PROVIDER } from '../src/environment-intelligence/environment-provider.interface';
import { EnvironmentProviderName } from '../src/environment-intelligence/environment-intelligence.constants';
import { SlotModeValue } from '../src/schedule/dto/schedule.constants';
import { ProductCategory } from '../src/shelf/shelf.types';
import { SuggestionGenerationJob } from '../src/suggestions/entities/suggestion-generation-job.entity';
import { SuggestionObservabilityEvent } from '../src/suggestions/entities/suggestion-observability-event.entity';
import {
  SuggestionGenerationJobStatus,
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
import {
  closeTestApp,
  createCompletedSkinProfile,
  createTestApp,
  createTestInventoryProduct,
  MockMailService,
} from './test-setup';

const ORIGIN = 'http://localhost:3000';
const TEST_USER = {
  email: 'suggestions@example.com',
  password: 'TestPass1',
  firstName: 'Suggestions',
  lastName: 'Test',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

type OnDemandCreateResponse = {
  id: string;
  slotId: string | null;
  requestSource: 'on_demand';
  generationStatus: string;
};

type TodayResponse = {
  date: string;
  slots: Array<{
    slotId: string;
    suggestion: {
      id: string;
      requestSource: 'scheduled';
      steps: Array<{
        id: string;
        stepOrder: number;
        routineStepId: string | null;
        inventoryProductId: string | null;
        productBrand: string | null;
        productName: string | null;
        stepLabel: string;
        routineNote: string | null;
        provenance: string;
      }>;
    } | null;
  }>;
  onDemandSuggestions: Array<{
    id: string;
    status: string;
    suggestion: {
      id: string;
      targetDate: string;
      targetTime: string;
      requestSource: 'on_demand';
      steps: Array<{
        id: string;
        stepOrder: number;
        inventoryProductId: string | null;
        productBrand: string | null;
        productName: string | null;
        stepLabel: string;
        routineNote: string | null;
      }>;
    };
  }>;
};

type HistoryResponse = {
  days: Array<{
    slots: Array<{
      suggestionId: string | null;
      requestSource: string;
      onDemandIntent: string | null;
      applicationLogId: string | null;
    }>;
  }>;
};

describe('Suggestions on-demand (e2e)', () => {
  let app: INestApplication;
  let mockMail: MockMailService;
  let accessToken: string;
  let productId: string;

  const aiGenerator = {
    generate: jest.fn((inputs: SuggestionGenerationInputs) =>
      buildOutput(inputs),
    ),
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
    mockMail = new MockMailService();
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
    productId = await createTestInventoryProduct(app, accessToken);
    await authPost('/suggestions/ai-consent', { granted: true }).expect(200);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('queues, generates, records, and returns on-demand suggestions in history', async () => {
    const firstCreate = await authPost('/suggestions/on-demand', {
      intent: 'post_workout',
      intensity: 'minimal',
      note: 'Back from training.',
      requestId: 'quick-e2e-20260506',
    }).expect(202);
    const created = firstCreate.body as OnDemandCreateResponse;
    expect(created).toEqual(
      expect.objectContaining({
        slotId: null,
        requestSource: 'on_demand',
        generationStatus: 'generating',
      }),
    );

    const duplicateCreate = await authPost('/suggestions/on-demand', {
      intent: 'post_workout',
      requestId: 'quick-e2e-20260506',
    }).expect(202);
    expect((duplicateCreate.body as OnDemandCreateResponse).id).toBe(
      created.id,
    );

    await generateQueuedSuggestion(created.id);

    const todayResponse = await authGet('/suggestions/today').expect(200);
    const today = todayResponse.body as TodayResponse;
    const onDemand = today.onDemandSuggestions.find(
      (item) => item.id === created.id,
    );
    expect(onDemand?.status).toBe('ready');
    expect(onDemand?.suggestion.requestSource).toBe('on_demand');
    const step = onDemand?.suggestion.steps[0];
    expect(step?.inventoryProductId).toBe(productId);

    const recordResponse = await authPost('/application-logs', {
      suggestionInstanceId: created.id,
      targetDate: onDemand?.suggestion.targetDate,
      targetTime: onDemand?.suggestion.targetTime,
      appliedAt: new Date().toISOString(),
      items: [
        {
          stepOrder: step?.stepOrder,
          suggestionStepId: step?.id,
          inventoryProductId: step?.inventoryProductId,
          productBrand: step?.productBrand,
          productName: step?.productName,
          stepLabel: step?.stepLabel,
          status: 'applied',
        },
      ],
    }).expect(201);
    expect(recordResponse.body.suggestionInstanceId).toBe(created.id);

    const historyDate = shiftIsoDate(today.date, -1);
    await moveSuggestionToDate(
      created.id,
      recordResponse.body.id as string,
      historyDate,
    );

    const historyResponse = await authGet(
      `/suggestions/history?range=custom&from=${historyDate}&to=${historyDate}&requestSource=on_demand`,
    ).expect(200);
    const history = historyResponse.body as HistoryResponse;
    expect(history.days[0]?.slots[0]).toEqual(
      expect.objectContaining({
        suggestionId: created.id,
        requestSource: 'on_demand',
        onDemandIntent: 'post_workout',
        applicationLogId: recordResponse.body.id,
      }),
    );
  });

  it('snapshots scheduled routine step notes and returns them in today suggestions', async () => {
    const { timeZone, slotTime } = openTodaySlotWindow();
    await setCurrentUserTimeZone(timeZone);
    const targetDate = readString(
      (await authGet('/suggestions/today', timeZone).expect(200)).body,
      'date',
    );
    const routineNote = 'Use a thin layer only after cleansing.';
    const createdSlot = await authPost('/schedule/slots', {
      dayOfWeek: dayOfWeekForIsoDate(targetDate, timeZone),
      slotTime,
      mode: SlotModeValue.Manual,
    }).expect(201);
    const slotId = readString(createdSlot.body, 'id');

    await authPut(`/schedule/slots/${slotId}/steps`, {
      steps: [
        {
          stepOrder: 0,
          inventoryProductId: productId,
          stepLabel: ProductCategory.Moisturizer,
          customLabel: null,
          notes: routineNote,
          optional: false,
          isSpecialistLocked: true,
        },
      ],
    }).expect(200);

    await generateScheduledSuggestion(slotId, targetDate, slotTime);

    const todayResponse = await authGet('/suggestions/today', timeZone).expect(
      200,
    );
    const today = todayResponse.body as TodayResponse;
    const slot = today.slots.find((item) => item.slotId === slotId);

    expect(slot?.suggestion?.requestSource).toBe(
      SuggestionRequestSource.Scheduled,
    );
    expect(slot?.suggestion?.steps[0]).toEqual(
      expect.objectContaining({
        inventoryProductId: productId,
        routineNote,
        provenance: SuggestionStepProvenance.SpecialistLocked,
      }),
    );
  });

  it('builds Today suggestions from seeded 30-plus day application, journal, and suggestion history', async () => {
    const { timeZone, slotTime } = openTodaySlotWindow(55);
    await setCurrentUserTimeZone(timeZone);
    const targetDate = readString(
      (await authGet('/suggestions/today', timeZone).expect(200)).body,
      'date',
    );
    const createdSlot = await authPost('/schedule/slots', {
      dayOfWeek: dayOfWeekForIsoDate(targetDate, timeZone),
      slotTime,
      mode: SlotModeValue.Manual,
    }).expect(201);
    const slotId = readString(createdSlot.body, 'id');

    await authPut(`/schedule/slots/${slotId}/steps`, {
      steps: [
        {
          stepOrder: 0,
          inventoryProductId: productId,
          stepLabel: ProductCategory.Moisturizer,
          customLabel: null,
          notes: null,
          optional: false,
          isSpecialistLocked: false,
        },
      ],
    }).expect(200);

    const dataSource = app.get(DataSource);
    const userId = await loadCurrentUserId(dataSource);
    await cleanupSeededSuggestionContextHistory(dataSource, 'hist');
    await seedThirtyDaySuggestionContextHistory({
      dataSource,
      userId,
      slotId,
      productId,
      targetDate,
      targetTime: slotTime,
    });

    try {
      const callsBeforeGeneration = aiGenerator.generate.mock.calls.length;
      await generateScheduledSuggestion(slotId, targetDate, slotTime);

      const generationCalls = aiGenerator.generate.mock.calls.slice(
        callsBeforeGeneration,
      );
      expect(generationCalls).toHaveLength(1);
      const generationInput = generationCalls[0]?.[0];
      expect(
        generationInput?.contextSummary.appliedProductHistory
          ?.recordsConsidered,
      ).toBeGreaterThanOrEqual(32);
      expect(
        generationInput?.contextSummary.journalSignals?.recordsConsidered,
      ).toBe(30);
      expect(
        generationInput?.contextSummary.routineMemory?.recordsConsidered,
      ).toBeGreaterThanOrEqual(62);
      const appliedProduct =
        generationInput?.contextSummary.appliedProductHistory?.products.find(
          (product) => product.productId === productId,
        );
      expect(appliedProduct).toEqual(
        expect.objectContaining({
          name: 'Schedule Fixture Moisturizer',
        }),
      );
      expect(appliedProduct?.useCount).toBeGreaterThanOrEqual(32);
      expect(
        generationInput?.contextSummary.routineMemory
          ?.recentSameDaypartFingerprints,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            productNames: ['Ritora Schedule Fixture Moisturizer'],
          }),
        ]),
      );

      const todayResponse = await authGet(
        '/suggestions/today',
        timeZone,
      ).expect(200);
      const today = todayResponse.body as TodayResponse;
      expect(
        today.slots.find((item) => item.slotId === slotId)?.suggestion,
      ).toEqual(
        expect.objectContaining({
          requestSource: SuggestionRequestSource.Scheduled,
        }),
      );
    } finally {
      await cleanupSeededSuggestionContextHistory(dataSource, 'hist');
    }
  });

  it('backfills older records when Today suggestion history has only 29 records in the 30-day window', async () => {
    const { timeZone, slotTime } = openTodaySlotWindow(65);
    await setCurrentUserTimeZone(timeZone);
    const targetDate = readString(
      (await authGet('/suggestions/today', timeZone).expect(200)).body,
      'date',
    );
    const createdSlot = await authPost('/schedule/slots', {
      dayOfWeek: dayOfWeekForIsoDate(targetDate, timeZone),
      slotTime,
      mode: SlotModeValue.Manual,
    }).expect(201);
    const slotId = readString(createdSlot.body, 'id');

    await authPut(`/schedule/slots/${slotId}/steps`, {
      steps: [
        {
          stepOrder: 0,
          inventoryProductId: productId,
          stepLabel: ProductCategory.Moisturizer,
          customLabel: null,
          notes: null,
          optional: false,
          isSpecialistLocked: false,
        },
      ],
    }).expect(200);

    const dataSource = app.get(DataSource);
    const userId = await loadCurrentUserId(dataSource);
    await moveExistingContextOutsideWindow(dataSource, userId, targetDate);
    await cleanupSeededSuggestionContextHistory(dataSource, 'bfctx');
    await seedBackfilledSuggestionContextHistory({
      dataSource,
      userId,
      slotId,
      productId,
      targetDate,
      targetTime: slotTime,
      prefix: 'bfctx',
    });

    try {
      const callsBeforeGeneration = aiGenerator.generate.mock.calls.length;
      const jobId = await generateScheduledSuggestion(
        slotId,
        targetDate,
        slotTime,
      );
      const generationInput = aiGenerator.generate.mock.calls.slice(
        callsBeforeGeneration,
      )[0]?.[0];
      const event = await dataSource
        .getRepository(SuggestionObservabilityEvent)
        .findOne({
          where: {
            user_id: userId,
            job_id: jobId,
            kind: 'generation_context_loaded',
          },
        });

      expect(
        generationInput?.recentJournalEntries.map((entry) => entry.id),
      ).toContain('bfctx-j-bf');
      expect(
        generationInput?.recentApplications.map((log) => log.id),
      ).toContain('bfctx-l-bf');
      expect(
        generationInput?.contextSummary.journalSignals?.recordsConsidered,
      ).toBe(30);
      expect(
        generationInput?.contextSummary.appliedProductHistory
          ?.recordsConsidered,
      ).toBeGreaterThanOrEqual(30);
      expect(
        generationInput?.contextSummary.routineMemory?.previousSuggestionCount,
      ).toBeGreaterThanOrEqual(30);
      expect(event?.metadata).toEqual(
        expect.objectContaining({
          journalBackfillRows: 1,
          applicationBackfillRows: 1,
          suggestionBackfillRows: 1,
          routineBreakBackfillRows: 1,
        }),
      );
    } finally {
      await cleanupSeededSuggestionContextHistory(dataSource, 'bfctx');
    }
  });

  it('excludes sensitive profile, journal, application, and suggestion history from Today generation without AI consent', async () => {
    const { timeZone, slotTime } = openTodaySlotWindow(75);
    await setCurrentUserTimeZone(timeZone);
    const targetDate = readString(
      (await authGet('/suggestions/today', timeZone).expect(200)).body,
      'date',
    );
    const createdSlot = await authPost('/schedule/slots', {
      dayOfWeek: dayOfWeekForIsoDate(targetDate, timeZone),
      slotTime,
      mode: SlotModeValue.Manual,
    }).expect(201);
    const slotId = readString(createdSlot.body, 'id');

    await authPut(`/schedule/slots/${slotId}/steps`, {
      steps: [
        {
          stepOrder: 0,
          inventoryProductId: productId,
          stepLabel: ProductCategory.Moisturizer,
          customLabel: null,
          notes: null,
          optional: false,
          isSpecialistLocked: false,
        },
      ],
    }).expect(200);

    const dataSource = app.get(DataSource);
    const userId = await loadCurrentUserId(dataSource);
    await moveExistingContextOutsideWindow(dataSource, userId, targetDate);
    await cleanupSeededSuggestionContextHistory(dataSource, 'noconsent');
    await seedBackfilledSuggestionContextHistory({
      dataSource,
      userId,
      slotId,
      productId,
      targetDate,
      targetTime: slotTime,
      prefix: 'noconsent',
    });
    await authPost('/suggestions/ai-consent', { granted: false }).expect(200);

    try {
      const callsBeforeGeneration = aiGenerator.generate.mock.calls.length;
      const jobId = await generateScheduledSuggestion(
        slotId,
        targetDate,
        slotTime,
      );
      const generationInput = aiGenerator.generate.mock.calls.slice(
        callsBeforeGeneration,
      )[0]?.[0];
      const event = await dataSource
        .getRepository(SuggestionObservabilityEvent)
        .findOne({
          where: {
            user_id: userId,
            job_id: jobId,
            kind: 'generation_context_loaded',
          },
        });

      expect(generationInput).toEqual(
        expect.objectContaining({
          skinProfile: null,
          recentJournalEntries: [],
          recentApplications: [],
          aiPersonalizationAllowed: false,
          aiPersonalizationBlockedReason:
            'ai_suggestion_processing_consent_missing',
        }),
      );
      expect(generationInput?.contextSummary).toEqual(
        expect.objectContaining({
          skinProfile: expect.objectContaining({
            primaryGoal: null,
            activeConcerns: [],
          }),
          governance: expect.objectContaining({
            aiPersonalizationAllowed: false,
            aiPersonalizationBlockedReason:
              'ai_suggestion_processing_consent_missing',
          }),
        }),
      );
      expect(generationInput?.contextSummary.appliedProductHistory).toEqual(
        expect.objectContaining({ recordsConsidered: 0, products: [] }),
      );
      expect(generationInput?.contextSummary.routineMemory).toEqual(
        expect.objectContaining({
          previousSuggestionCount: 0,
          recordsConsidered: expect.any(Number),
        }),
      );
      expect(event?.metadata).toEqual(
        expect.objectContaining({
          sensitiveContextRead: false,
          journalRows: 0,
          applicationRows: 0,
          suggestionRows: 0,
        }),
      );
    } finally {
      await authPost('/suggestions/ai-consent', { granted: true }).expect(200);
      await cleanupSeededSuggestionContextHistory(dataSource, 'noconsent');
    }
  });

  function authGet(path: string, timeZone = 'Europe/Stockholm') {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Timezone', timeZone);
  }

  function authPost(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', ORIGIN)
      .set('X-Timezone', 'Europe/Stockholm')
      .send(body);
  }

  function authPut(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put(`/api/v1${path}`)
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
    if (!job) throw new Error('Queued on-demand job not found');
    await app.get(SuggestionGenerationService).generateForJob(job);
  }

  async function generateScheduledSuggestion(
    slotId: string,
    targetDate: string,
    targetTime: string,
  ): Promise<string> {
    const dataSource = app.get(DataSource);
    const userId = await loadCurrentUserId(dataSource);
    const jobRepo = dataSource.getRepository(SuggestionGenerationJob);
    const job = await jobRepo.save(
      jobRepo.create({
        user_id: userId,
        slot_id: slotId,
        suggestion_instance_id: null,
        request_source: SuggestionRequestSource.Scheduled,
        target_date: targetDate,
        target_time: targetTime,
        visible_at: new Date(),
        status: SuggestionGenerationJobStatus.Queued,
        attempt_count: 0,
        run_after: new Date(),
        locked_at: null,
        locked_by: null,
        last_error: null,
      }),
    );
    await app.get(SuggestionGenerationService).generateForJob(job);
    return job.id;
  }

  async function loadCurrentUserId(dataSource: DataSource): Promise<string> {
    const rows: Array<{ id: unknown }> = await dataSource.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [TEST_USER.email],
    );
    const id = rows[0]?.id;
    if (typeof id !== 'string') {
      throw new Error('Could not resolve e2e user id.');
    }
    return id;
  }

  async function setCurrentUserTimeZone(timeZone: string): Promise<void> {
    const dataSource = app.get(DataSource);
    await dataSource.query('UPDATE users SET time_zone = $1 WHERE email = $2', [
      timeZone,
      TEST_USER.email,
    ]);
  }

  async function moveSuggestionToDate(
    suggestionId: string,
    applicationLogId: string,
    targetDate: string,
  ): Promise<void> {
    const dataSource = app.get(DataSource);
    await dataSource.query(
      `
        UPDATE suggestion_instances
        SET target_date = $2
        WHERE id = $1
      `,
      [suggestionId, targetDate],
    );
    await dataSource.query(
      `
        UPDATE application_logs
        SET target_date = $2
        WHERE id = $1
      `,
      [applicationLogId, targetDate],
    );
  }

  async function seedThirtyDaySuggestionContextHistory(input: {
    dataSource: DataSource;
    userId: string;
    slotId: string;
    productId: string;
    targetDate: string;
    targetTime: string;
  }): Promise<void> {
    const { dataSource, userId, slotId, productId, targetDate, targetTime } =
      input;
    await dataSource.transaction(async (manager) => {
      for (let index = 0; index < 30; index += 1) {
        const date = shiftIsoDate(targetDate, -index);
        await manager.query(
          `
            INSERT INTO skin_journal_entries (
              id, user_id, entry_date, time_zone, analysis_status,
              analysis_concern_keys, has_reaction_signal, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, 'completed', $5, false, $6, $6)
          `,
          [
            `hist-journal-${padHistoryIndex(index)}`,
            userId,
            date,
            'Europe/Stockholm',
            index % 2 === 0 ? ['dryness'] : ['acne'],
            new Date(`${date}T06:00:00.000Z`),
          ],
        );
      }

      for (let index = 0; index < 32; index += 1) {
        const date = shiftIsoDate(targetDate, -((index % 29) + 1));
        const logId = `hist-log-${padHistoryIndex(index)}`;
        await manager.query(
          `
            INSERT INTO application_logs (
              id, user_id, slot_id, target_date, target_time, daypart,
              applied_at, has_been_edited, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, 'morning', $6, $7, $6, $6)
          `,
          [
            logId,
            userId,
            slotId,
            date,
            targetTime,
            new Date(`${date}T07:30:00.000Z`),
            index % 7 === 0,
          ],
        );
        await manager.query(
          `
            INSERT INTO application_log_items (
              id, application_log_id, step_order, inventory_product_id,
              product_brand_snapshot, product_name_snapshot, step_label,
              status, item_source, applied_at, created_at, updated_at
            )
            VALUES ($1, $2, 0, $3, 'Ritora', 'Schedule Fixture Moisturizer',
              $4, $5, $6, $7, $7, $7)
          `,
          [
            `hist-log-item-${padHistoryIndex(index)}`,
            logId,
            productId,
            ProductCategory.Moisturizer,
            ApplicationItemStatus.Applied,
            ApplicationItemSource.Recommended,
            new Date(`${date}T07:31:00.000Z`),
          ],
        );
      }

      for (let index = 0; index < 30; index += 1) {
        const date = shiftIsoDate(targetDate, -((index % 29) + 1));
        const suggestionId = `hist-sugg-${padHistoryIndex(index)}`;
        await manager.query(
          `
            INSERT INTO suggestion_instances (
              id, user_id, slot_id, request_source, target_date, target_time,
              daypart, mode, generation_status, visible_at, generated_at,
              has_reaction_signal, simplified_for_reaction, ai_retry_count,
              created_at, updated_at
            )
            VALUES ($1, $2, null, $3, $4, $5, 'morning', $6, $7, $8, $8,
              false, false, 0, $8, $8)
          `,
          [
            suggestionId,
            userId,
            SuggestionRequestSource.OnDemand,
            date,
            targetTime,
            SuggestionMode.Ai,
            SuggestionGenerationStatus.Ready,
            new Date(`${date}T06:45:00.000Z`),
          ],
        );
        await manager.query(
          `
            INSERT INTO suggestion_steps (
              id, suggestion_instance_id, step_order, routine_step_id,
              inventory_product_id, product_brand_snapshot,
              product_name_snapshot, step_label, custom_label,
              application_method, quantity, wait_after_minutes, explanation,
              routine_note_snapshot, provenance, chips, safety_warnings,
              created_at
            )
            VALUES ($1, $2, 0, null, $3, 'Ritora',
              'Schedule Fixture Moisturizer', $4, null, null, null, null,
              null, null, $5, null, null, $6)
          `,
          [
            `hist-sugg-step-${padHistoryIndex(index)}`,
            suggestionId,
            productId,
            ProductCategory.Moisturizer,
            SuggestionStepProvenance.AiAdded,
            new Date(`${date}T06:46:00.000Z`),
          ],
        );
      }
    });
  }

  async function seedBackfilledSuggestionContextHistory(input: {
    dataSource: DataSource;
    userId: string;
    slotId: string;
    productId: string;
    targetDate: string;
    targetTime: string;
    prefix: string;
  }): Promise<void> {
    const {
      dataSource,
      userId,
      slotId,
      productId,
      targetDate,
      targetTime,
      prefix,
    } = input;
    await dataSource.transaction(async (manager) => {
      for (let index = 0; index < 29; index += 1) {
        const date = shiftIsoDate(targetDate, -index);
        await insertHistoryJournal(manager, {
          id: `${prefix}-j-${padHistoryIndex(index)}`,
          userId,
          date,
          concerns: index % 2 === 0 ? ['dryness'] : ['texture'],
        });
      }
      await insertHistoryJournal(manager, {
        id: `${prefix}-j-bf`,
        userId,
        date: shiftIsoDate(targetDate, -45),
        concerns: ['barrier'],
      });

      for (let index = 0; index < 29; index += 1) {
        const date = shiftIsoDate(targetDate, -(index + 1));
        await insertHistoryApplication(manager, {
          logId: `${prefix}-l-${padHistoryIndex(index)}`,
          itemId: `${prefix}-li-${padHistoryIndex(index)}`,
          userId,
          slotId,
          productId,
          date,
          targetTime,
        });
      }
      await insertHistoryApplication(manager, {
        logId: `${prefix}-l-bf`,
        itemId: `${prefix}-li-bf`,
        userId,
        slotId,
        productId,
        date: shiftIsoDate(targetDate, -45),
        targetTime,
      });

      for (let index = 0; index < 29; index += 1) {
        const date = shiftIsoDate(targetDate, -(index + 1));
        await insertHistorySuggestion(manager, {
          suggestionId: `${prefix}-s-${padHistoryIndex(index)}`,
          stepId: `${prefix}-ss-${padHistoryIndex(index)}`,
          userId,
          productId,
          date,
          targetTime,
        });
      }
      await insertHistorySuggestion(manager, {
        suggestionId: `${prefix}-s-bf`,
        stepId: `${prefix}-ss-bf`,
        userId,
        productId,
        date: shiftIsoDate(targetDate, -45),
        targetTime,
      });

      for (let index = 0; index < 29; index += 1) {
        const date = shiftIsoDate(targetDate, -(index + 1));
        await insertHistoryRoutineBreak(manager, {
          id: `${prefix}-b-${padHistoryIndex(index)}`,
          userId,
          date,
        });
      }
      await insertHistoryRoutineBreak(manager, {
        id: `${prefix}-b-bf`,
        userId,
        date: shiftIsoDate(targetDate, -45),
      });
    });
  }

  async function cleanupSeededSuggestionContextHistory(
    dataSource: DataSource,
    prefix: string,
  ): Promise<void> {
    const pattern = `${prefix}-%`;
    await dataSource.query(
      'DELETE FROM application_log_items WHERE id LIKE $1',
      [pattern],
    );
    await dataSource.query('DELETE FROM application_logs WHERE id LIKE $1', [
      pattern,
    ]);
    await dataSource.query('DELETE FROM suggestion_steps WHERE id LIKE $1', [
      pattern,
    ]);
    await dataSource.query(
      'DELETE FROM suggestion_instances WHERE id LIKE $1',
      [pattern],
    );
    await dataSource.query('DELETE FROM routine_breaks WHERE id LIKE $1', [
      pattern,
    ]);
    await dataSource.query(
      'DELETE FROM skin_journal_entries WHERE id LIKE $1',
      [pattern],
    );
  }

  async function moveExistingContextOutsideWindow(
    dataSource: DataSource,
    userId: string,
    targetDate: string,
  ): Promise<void> {
    const outsideWindowDate = shiftIsoDate(targetDate, -60);
    const protectedHistoryPattern = 'bfctx-%';
    await dataSource.query(
      `
        UPDATE application_logs
        SET target_date = $3
        WHERE user_id = $1 AND id NOT LIKE $2
      `,
      [userId, protectedHistoryPattern, outsideWindowDate],
    );
    await dataSource.query(
      `
        UPDATE suggestion_instances
        SET target_date = $3
        WHERE user_id = $1 AND id NOT LIKE $2
      `,
      [userId, protectedHistoryPattern, outsideWindowDate],
    );
  }

  async function insertHistoryJournal(
    manager: EntityManager,
    input: {
      id: string;
      userId: string;
      date: string;
      concerns: string[];
    },
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO skin_journal_entries (
          id, user_id, entry_date, time_zone, analysis_status,
          analysis_concern_keys, has_reaction_signal, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 'completed', $5, false, $6, $6)
      `,
      [
        input.id,
        input.userId,
        input.date,
        'Europe/Stockholm',
        input.concerns,
        new Date(`${input.date}T06:00:00.000Z`),
      ],
    );
  }

  async function insertHistoryApplication(
    manager: EntityManager,
    input: {
      logId: string;
      itemId: string;
      userId: string;
      slotId: string;
      productId: string;
      date: string;
      targetTime: string;
    },
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO application_logs (
          id, user_id, slot_id, target_date, target_time, daypart,
          applied_at, has_been_edited, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'morning', $6, false, $6, $6)
      `,
      [
        input.logId,
        input.userId,
        input.slotId,
        input.date,
        input.targetTime,
        new Date(`${input.date}T07:30:00.000Z`),
      ],
    );
    await manager.query(
      `
        INSERT INTO application_log_items (
          id, application_log_id, step_order, inventory_product_id,
          product_brand_snapshot, product_name_snapshot, step_label,
          status, item_source, applied_at, created_at, updated_at
        )
        VALUES ($1, $2, 0, $3, 'Ritora', 'Schedule Fixture Moisturizer',
          $4, $5, $6, $7, $7, $7)
      `,
      [
        input.itemId,
        input.logId,
        input.productId,
        ProductCategory.Moisturizer,
        ApplicationItemStatus.Applied,
        ApplicationItemSource.Recommended,
        new Date(`${input.date}T07:31:00.000Z`),
      ],
    );
  }

  async function insertHistorySuggestion(
    manager: EntityManager,
    input: {
      suggestionId: string;
      stepId: string;
      userId: string;
      productId: string;
      date: string;
      targetTime: string;
    },
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO suggestion_instances (
          id, user_id, slot_id, request_source, target_date, target_time,
          daypart, mode, generation_status, visible_at, generated_at,
          has_reaction_signal, simplified_for_reaction, ai_retry_count,
          created_at, updated_at
        )
        VALUES ($1, $2, null, $3, $4, $5, 'morning', $6, $7, $8, $8,
          false, false, 0, $8, $8)
      `,
      [
        input.suggestionId,
        input.userId,
        SuggestionRequestSource.OnDemand,
        input.date,
        input.targetTime,
        SuggestionMode.Ai,
        SuggestionGenerationStatus.Ready,
        new Date(`${input.date}T06:45:00.000Z`),
      ],
    );
    await manager.query(
      `
        INSERT INTO suggestion_steps (
          id, suggestion_instance_id, step_order, routine_step_id,
          inventory_product_id, product_brand_snapshot,
          product_name_snapshot, step_label, custom_label,
          application_method, quantity, wait_after_minutes, explanation,
          routine_note_snapshot, provenance, chips, safety_warnings,
          created_at
        )
        VALUES ($1, $2, 0, null, $3, 'Ritora',
          'Schedule Fixture Moisturizer', $4, null, null, null, null,
          null, null, $5, null, null, $6)
      `,
      [
        input.stepId,
        input.suggestionId,
        input.productId,
        ProductCategory.Moisturizer,
        SuggestionStepProvenance.AiAdded,
        new Date(`${input.date}T06:46:00.000Z`),
      ],
    );
  }

  async function insertHistoryRoutineBreak(
    manager: EntityManager,
    input: { id: string; userId: string; date: string },
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO routine_breaks (
          id, user_id, starts_at, ends_at, reason, status, resumed_at,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, null, 'resumed', $4, $3, $4)
      `,
      [
        input.id,
        input.userId,
        new Date(`${input.date}T04:00:00.000Z`),
        new Date(`${input.date}T05:00:00.000Z`),
      ],
    );
  }
});

function readString(value: unknown, key: string): string {
  if (typeof value === 'object' && value !== null) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === 'string') {
      return field;
    }
  }
  throw new Error(`Expected response field ${key} to be a string.`);
}

function dayOfWeekForIsoDate(date: string, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(`${date}T12:00:00.000Z`));
  return weekday.toLowerCase();
}

function openTodaySlotWindow(minutesAhead = 30): {
  timeZone: string;
  slotTime: string;
} {
  const candidates = [
    'Europe/Stockholm',
    'UTC',
    'Pacific/Honolulu',
    'Pacific/Kiritimati',
  ];
  for (const timeZone of candidates) {
    const minutes = localMinutesOfDay(new Date(), timeZone);
    if (minutes <= 23 * 60 + (59 - minutesAhead)) {
      return { timeZone, slotTime: minutesToSlotTime(minutes + minutesAhead) };
    }
  }
  return { timeZone: 'UTC', slotTime: '23:59' };
}

function localMinutesOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? 0,
  );
  return hour * 60 + minute;
}

function minutesToSlotTime(minutes: number): string {
  const bounded = Math.min(minutes, 23 * 60 + 59);
  const hour = Math.floor(bounded / 60)
    .toString()
    .padStart(2, '0');
  const minute = (bounded % 60).toString().padStart(2, '0');
  return `${hour}:${minute}`;
}

function shiftIsoDate(date: string, days: number): string {
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

function padHistoryIndex(index: number): string {
  return index.toString().padStart(2, '0');
}

function buildOutput(
  inputs: SuggestionGenerationInputs,
): SuggestionGenerationOutput {
  const routineStep = inputs.routineSteps[0] ?? null;
  const product = routineStep?.product ?? inputs.shelfActiveProducts[0];
  return {
    mode: SuggestionMode.Ai,
    hasReactionSignal: false,
    simplifiedForReaction: false,
    explanation: {
      headline: 'Quick reset',
      body: ['Use a short routine for right now.'],
      perStepReasons: [{ stepOrder: 1, reason: 'Gentle after activity.' }],
      skipped: [],
      inputs: [],
    },
    gapRecommendations: [],
    safetyFlags: [],
    steps: [
      {
        stepOrder: routineStep?.step_order ?? 1,
        routineStepId: routineStep?.id ?? null,
        inventoryProductId:
          routineStep?.inventory_product_id ?? product?.id ?? null,
        productBrand: product?.brand ?? 'Ritora',
        productName: product?.name ?? 'Fixture moisturizer',
        stepLabel: routineStep?.step_label ?? ProductCategory.Moisturizer,
        customLabel: routineStep?.custom_label ?? null,
        applicationMethod: 'fingertips',
        quantity: 'pea_size',
        waitAfterMinutes: 1,
        explanation: 'Refresh without overdoing it.',
        routineNote: routineStep?.notes ?? null,
        provenance: routineStep
          ? routineStep.is_specialist_locked
            ? SuggestionStepProvenance.SpecialistLocked
            : SuggestionStepProvenance.UserRoutine
          : SuggestionStepProvenance.AiAdded,
        chips: [],
        safetyWarnings: [],
      },
    ],
    metadata: {
      model: 'test-suggestion-model',
      promptVersion: 'test-prompt',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      estimatedCostUsd: 0.00001,
      durationMs: 1,
    },
  };
}
