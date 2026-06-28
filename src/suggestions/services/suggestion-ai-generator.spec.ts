import { ConfigService } from '@nestjs/config';
import {
  OPENAI_QUICK_SUGGESTION_REASONING_EFFORT,
  OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT,
} from '../../common/utils/openai-request-options';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import {
  EnvironmentAirQualityRisk,
  EnvironmentConfidence,
  EnvironmentHumidityBand,
  EnvironmentProviderName,
  EnvironmentSeason,
  EnvironmentStatus,
  EnvironmentTemperatureBand,
  EnvironmentUvRisk,
  EnvironmentWaterHardness,
  EnvironmentWaterSensitivity,
} from '../../environment-intelligence/environment-intelligence.constants';
import type { EnvironmentContextSummary } from '../../environment-intelligence/environment-intelligence.types';
import { AnalysisSeverity } from '../../ingredients/ingredients.types';
import {
  ApplicationMethod,
  PreferredTimeOfDay,
  ProductCategory,
  ProductIntroductionStatus,
  Quantity,
  ShelfStatus,
} from '../../shelf/shelf.types';
import {
  SuggestionDaypart,
  SuggestionEvidenceSourceId,
  SuggestionMode,
  SuggestionRequestSource,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import {
  SUGGESTION_AI_QUICK_TIMEOUT_MS,
  SUGGESTION_AI_TODAYS_TIMEOUT_MS,
  SuggestionAiGenerator,
  SuggestionGenerationInputs,
} from './suggestion-ai-generator';
import { getSuggestionEvidenceSources } from './suggestion-evidence-sources';

describe('SuggestionAiGenerator', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses a bounded agentic OpenAI workflow for scheduled suggestions', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: '',
                    body: [],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Morning),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse(call[1]?.body as string) as Record<string, unknown>,
    );
    expect(bodies[0]).toEqual(
      expect.objectContaining({
        model: 'gpt-4.1-mini',
        store: false,
        reasoning: { effort: OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT },
        temperature: 0,
        max_output_tokens: 4000,
        text: expect.objectContaining({
          format: expect.objectContaining({
            name: 'todays_suggestion_agent_plan',
          }),
        }),
      }),
    );
    expect(bodies[1]).toEqual(
      expect.objectContaining({
        model: 'gpt-4.1-mini',
        store: false,
        reasoning: { effort: OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT },
        temperature: 0,
        max_output_tokens: 24000,
        text: expect.objectContaining({
          format: expect.objectContaining({ name: 'suggestion_response' }),
        }),
      }),
    );
    expect(bodies[2]).toEqual(
      expect.objectContaining({
        model: 'gpt-4.1-mini',
        store: false,
        reasoning: { effort: OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT },
        temperature: 0,
        max_output_tokens: 5000,
        text: expect.objectContaining({
          format: expect.objectContaining({
            name: 'todays_suggestion_agent_review',
          }),
        }),
      }),
    );
    const requestedTimeoutMs = timeoutSpy.mock.calls[0]?.[0];
    expect(requestedTimeoutMs).toBeGreaterThanOrEqual(
      SUGGESTION_AI_TODAYS_TIMEOUT_MS - 1_000,
    );
    expect(requestedTimeoutMs).toBeLessThanOrEqual(
      SUGGESTION_AI_TODAYS_TIMEOUT_MS,
    );
  });

  it('repairs a scheduled suggestion once when agent self-review finds a blocking issue', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(openAiTextResponse(agentPlan()))
      .mockResolvedValueOnce(
        openAiTextResponse({
          simplifiedForReaction: false,
          explanation: {
            headline: 'Morning plan',
            body: ['Use a light morning plan.'],
            perStepReasons: [],
            skipped: [],
            inputs: [],
          },
          steps: [aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser)],
          gapRecommendations: [],
          safetyFlags: [],
        }),
      )
      .mockResolvedValueOnce(
        openAiTextResponse({
          passed: false,
          blockingIssues: [
            {
              code: 'missing_required_spf',
              severity: 'high',
              message: 'Morning output omitted required owned SPF.',
              productIds: ['spf-1'],
            },
          ],
          nonBlockingIssues: [],
          repairInstructions: ['Include the eligible owned SPF step.'],
        }),
      )
      .mockResolvedValueOnce(
        openAiTextResponse({
          simplifiedForReaction: false,
          explanation: {
            headline: 'Morning shelf plan',
            body: ['Use your morning shelf steps.'],
            perStepReasons: [],
            skipped: [],
            inputs: [],
          },
          steps: [
            aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
            aiProductStep(1, 'moisturizer-1', ProductCategory.Moisturizer),
            aiProductStep(2, 'spf-1', ProductCategory.SunProtection),
          ],
          gapRecommendations: [],
          safetyFlags: [],
        }),
      )
      .mockResolvedValueOnce(openAiTextResponse(agentPassingReview()));
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Morning),
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const repairBody = JSON.parse(
      fetchMock.mock.calls[3]?.[1]?.body as string,
    ) as { input: { content: { text: string }[] }[] };
    expect(repairBody.input[1]?.content[0]?.text).toContain(
      'Include the eligible owned SPF step.',
    );
    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'spf-1' }),
      ]),
    );
  });

  it('retries a scheduled OpenAI rate limit response within the Today timeout budget', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(openAiErrorResponse(429, '0'))
      .mockResolvedValueOnce(openAiTextResponse(agentPlan()))
      .mockResolvedValueOnce(
        openAiTextResponse({
          simplifiedForReaction: false,
          explanation: {
            headline: 'Morning shelf plan',
            body: ['Use your morning shelf steps.'],
            perStepReasons: [],
            skipped: [],
            inputs: [],
          },
          steps: [
            aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
            aiProductStep(1, 'moisturizer-1', ProductCategory.Moisturizer),
            aiProductStep(2, 'spf-1', ProductCategory.SunProtection),
          ],
          gapRecommendations: [],
          safetyFlags: [],
        }),
      )
      .mockResolvedValueOnce(openAiTextResponse(agentPassingReview()));
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Morning),
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
  });

  it('uses medium reasoning for on-demand quick suggestions', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Quick answer',
                    body: ['Use a light shelf step now.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Noon);
    inputs.requestSource = SuggestionRequestSource.OnDemand;
    inputs.requestContext = {
      intent: 'quick_refresh',
      intensity: 'minimal',
      note: 'Need a quick check.',
      activityAt: null,
      requestedAt: '2026-04-29T12:00:00.000Z',
    };
    inputs.contextSummary.requestSource = SuggestionRequestSource.OnDemand;
    inputs.contextSummary.onDemand = inputs.requestContext;

    await generator.generate(inputs);

    const body = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(body).toEqual(
      expect.objectContaining({
        reasoning: { effort: OPENAI_QUICK_SUGGESTION_REASONING_EFFORT },
      }),
    );
    expect(timeoutSpy).toHaveBeenCalledWith(SUGGESTION_AI_QUICK_TIMEOUT_MS);
  });

  it('uses the structured reaction context even when the journal flag has not been backfilled', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    const result = await generator.generate({
      slotId: 'slot-1',
      requestSource: SuggestionRequestSource.Scheduled,
      requestContext: null,
      targetDate: '2026-04-29',
      targetTime: '08:00',
      daypart: SuggestionDaypart.Morning,
      skinProfile: null,
      shelfActiveProducts: [],
      shelfFinishedProductIds: [],
      routineSteps: [],
      recentJournalEntries: [],
      recentApplications: [],
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
      environmentSnapshotId: null,
      contextSummary: {
        cacheKey: 'ctx',
        builtAt: '2026-04-29T06:00:00.000Z',
        targetDate: '2026-04-29',
        targetTime: '08:00',
        daypart: SuggestionDaypart.Morning,
        requestSource: SuggestionRequestSource.Scheduled,
        onDemand: null,
        environment: null,
        skinProfile: {
          primaryGoal: null,
          skinType: null,
          sensitivityLevel: null,
          activeConcerns: [],
          pregnancyStatus: null,
        },
        reaction: {
          hasSignal: true,
          severity: 'moderate',
          confidence: 0.8,
          indicators: ['redness'],
          affectedZones: ['cheeks'],
          concernKeys: ['redness_inflammation'],
          daysSinceLatestSignal: 0,
          barrierCompromised: true,
          photoInputImages: 3,
          multiAnglePhotoEntries: 1,
        },
        routineBreak: {
          recentlyResumed: false,
          lastPausedFrom: null,
          lastPausedUntil: null,
        },
        productScores: [],
        applicationPatterns: {
          days: 0,
          daysSinceLastApplication: null,
          conservativeRestart: true,
          skippedByCategory: {},
          substitutedByCategory: {},
          addedOffShelfCount: 0,
          editedLogCount: 0,
          adherenceByCategory: {},
        },
        safetyConstraints: ['barrier_recovery_mode'],
        governance: {
          safetyPolicyVersion: 'test-policy',
          safetyPolicyReviewedAt: '2026-05-04',
          aiPersonalizationAllowed: true,
          aiPersonalizationBlockedReason: null,
        },
        evidenceSources: [],
        skippedCandidates: [],
      },
    } satisfies SuggestionGenerationInputs);

    expect(result.hasReactionSignal).toBe(true);
    expect(result.metadata.model).toBe('deterministic-baseline');
    expect(result.safetyFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Recent reaction'),
        }),
      ]),
    );
  });

  it('removes pregnancy-caution retinoid steps instead of falling back', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening plan',
                    body: [],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    {
                      stepOrder: 0,
                      routineStepId: null,
                      inventoryProductId: 'retinoid-1',
                      productBrand: 'Ava Lab',
                      productName: 'Retinol Night Serum',
                      stepLabel: ProductCategory.Treatment,
                      customLabel: null,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Evening active step.',
                      provenance: 'ai_added',
                      chips: [],
                      safetyWarnings: [],
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      pregnancy_status: 'pregnant',
      safety_context: { conditions: ['pregnancy'] },
    } as unknown as SkinProfile;
    inputs.contextSummary.skinProfile.pregnancyStatus = 'pregnant';
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Night Serum', ProductCategory.Treatment),
    );
    inputs.contextSummary.productScores.push(
      productScore('retinoid-1', ProductCategory.Treatment, 90, [
        'retinoid',
        'retinol',
      ]),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'retinoid-1' }),
      ]),
    );
    expect(result.safetyFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Pregnancy'),
        }),
      ]),
    );
  });

  it('falls back when OpenAI omits owned SPF from a daytime suggestion', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Post workout',
                    body: [],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    {
                      stepOrder: 0,
                      routineStepId: null,
                      inventoryProductId: 'cleanser-1',
                      productBrand: 'Ava Lab',
                      productName: 'Soft Cleanser',
                      stepLabel: ProductCategory.Cleanser,
                      customLabel: null,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Cleanse after sweating.',
                      provenance: 'ai_added',
                      chips: [],
                      safetyWarnings: [],
                    },
                    {
                      stepOrder: 1,
                      routineStepId: null,
                      inventoryProductId: 'moisturizer-1',
                      productBrand: 'Ava Lab',
                      productName: 'Barrier Cream',
                      stepLabel: ProductCategory.Moisturizer,
                      customLabel: null,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Rehydrate after cleansing.',
                      provenance: 'ai_added',
                      chips: [],
                      safetyWarnings: [],
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Noon),
    );

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'spf-1' }),
      ]),
    );
  });

  it('keeps medication safety rationale in deterministic fallback output', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      primary_goal: 'manage acne while on medication',
      safety_context: {
        medications: ['oral acne medication'],
        photosensitizing_other: true,
      },
      under_dermatologist_care: 'yes',
    } as unknown as SkinProfile;
    inputs.contextSummary.skinProfile.primaryGoal =
      'manage acne while on medication';
    inputs.contextSummary.productScores.push(
      productScore('retinoid-1', ProductCategory.Treatment, 90, ['retinoid']),
      productScore('bha-1', ProductCategory.Exfoliant, 88, ['bha']),
    );
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Night Serum', ProductCategory.Treatment),
      product('bha-1', 'BHA 2% Liquid', ProductCategory.Exfoliant),
    );

    const result = await generator.generate(inputs);

    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'retinoid-1' }),
        expect.objectContaining({ inventoryProductId: 'bha-1' }),
      ]),
    );
    expect(JSON.stringify(result.safetyFlags).toLowerCase()).toContain(
      'medication',
    );
    expect(JSON.stringify(result.safetyFlags).toLowerCase()).not.toContain(
      'pregnancy',
    );
    expect(result.explanation.body.join(' ').toLowerCase()).toContain(
      'medication',
    );
  });

  it('removes medication-context strong active steps instead of falling back', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Gentle acne evening',
                    body: [
                      'A gentle evening base fits tonight.',
                      'BHA is the acne-focused step.',
                    ],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'bha-1', ProductCategory.Exfoliant),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      primary_goal: 'manage acne while on medication',
      safety_context: {
        medications: ['oral acne medication'],
        photosensitizing_other: true,
      },
      under_dermatologist_care: 'yes',
    } as unknown as SkinProfile;
    inputs.contextSummary.safetyConstraints.push(
      'pregnancy_or_medication_active_caution',
    );
    inputs.shelfActiveProducts.push(
      product('bha-1', 'BHA 2% Liquid', ProductCategory.Exfoliant),
    );
    inputs.contextSummary.productScores.push(
      productScore('bha-1', ProductCategory.Exfoliant, 88, ['bha']),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'bha-1' }),
      ]),
    );
    expect(result.explanation.body.join(' ').toLowerCase()).not.toContain(
      'bha',
    );
    expect(result.explanation.body.join(' ').toLowerCase()).toContain(
      'medication',
    );
  });

  it('repairs missing medication caution in the main explanation', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Gentle evening routine',
                    body: [
                      'Keep tonight simple and barrier-focused.',
                      'Strong actives are spaced out for safety.',
                    ],
                    perStepReasons: [],
                    skipped: [
                      {
                        name: 'Ava Lab Retinol Night Serum',
                        reason: 'Strong active should be spaced carefully.',
                      },
                    ],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [
                    {
                      severity: 'warning',
                      message:
                        'Retinol and BHA are spaced out because of medication context.',
                      ingredientSlugs: ['retinol'],
                      sourceIds: [
                        SuggestionEvidenceSourceId.AadRetinoidRetinol,
                      ],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      primary_goal: 'manage acne while on medication',
      safety_context: {
        medications: ['oral acne medication'],
      },
    } as unknown as SkinProfile;

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.explanation.body.join(' ').toLowerCase()).toContain(
      'medication',
    );
    expect(result.explanation.body.join(' ').toLowerCase()).toContain(
      'responsible professional',
    );
  });

  it('accepts localized medication caution in the main explanation', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Rutina suave',
                    body: ['Contexto de medicacion: pausa retinoides hoy.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.language = 'es';
    inputs.skinProfile = {
      primary_goal: 'controlar acne con medicacion',
      safety_context: {
        medications: ['oral acne medication'],
      },
    } as unknown as SkinProfile;

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
  });

  it('removes dry-barrier strong active steps instead of falling back', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening hydration with AHA',
                    body: [
                      'Dry winter air favors hydration and barrier support tonight.',
                      'The AHA toner fits the evening slot.',
                    ],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'aha-1', ProductCategory.Toner),
                    aiProductStep(2, 'serum-1', ProductCategory.Serum),
                    aiProductStep(
                      3,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      skin_type: 'dry',
      sensitivity_level: 'medium',
      primary_goal: 'reduce winter dryness',
      current_concerns: ['dryness', 'flaking'],
    } as unknown as SkinProfile;
    inputs.contextSummary.skinProfile = {
      ...inputs.contextSummary.skinProfile,
      primaryGoal: 'reduce winter dryness',
      skinType: 'dry',
      sensitivityLevel: 'medium',
      activeConcerns: ['dryness', 'flaking'],
    };
    inputs.contextSummary.environment = {
      status: EnvironmentStatus.Available,
      provider: EnvironmentProviderName.OpenMeteo,
      generatedAt: '2026-04-29T06:00:00.000Z',
      locationPersonalized: true,
      season: EnvironmentSeason.Winter,
      temperatureCelsius: 2,
      temperatureBand: EnvironmentTemperatureBand.Cold,
      humidity: 18,
      humidityBand: EnvironmentHumidityBand.VeryDry,
      uvIndex: 1,
      uvRisk: EnvironmentUvRisk.Low,
      airQualityIndex: 22,
      airQualityRisk: EnvironmentAirQualityRisk.Good,
      pm25: null,
      pm10: null,
      pollenRisk: null,
      conditionLabel: 'Cold and dry',
      waterHardness: EnvironmentWaterHardness.Unknown,
      waterSensitivity: EnvironmentWaterSensitivity.None,
      climateSensitivities: ['dry_air'],
      transitionSignals: [],
      confidence: EnvironmentConfidence.Provider,
      stale: false,
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
    };
    inputs.contextSummary.safetyConstraints = ['environment_barrier_support'];
    inputs.shelfActiveProducts.push(
      product('aha-1', 'Glycolic Toner', ProductCategory.Toner),
    );
    inputs.contextSummary.productScores = [
      productScore('aha-1', ProductCategory.Toner, 97, ['aha', 'glycolic']),
      productScore('serum-1', ProductCategory.Serum, 88, ['humectant']),
      productScore('cleanser-1', ProductCategory.Cleanser, 84, []),
      productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
        'ceramide',
      ]),
    ];

    const result = await generator.generate(inputs);
    const selectedProductIds = result.steps.map(
      (step) => step.inventoryProductId,
    );

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(selectedProductIds).not.toContain('aha-1');
    expect(selectedProductIds).toEqual(
      expect.arrayContaining(['cleanser-1', 'serum-1', 'moisturizer-1']),
    );
  });

  it('removes strong actives for high-sensitivity reaction history without explicit tolerance', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening barrier with retinol',
                    body: [
                      'Gentle cleanse first.',
                      'Retinol stays at night.',
                      'Barrier cream finishes the routine.',
                    ],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'retinoid-1', ProductCategory.Treatment),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      skin_type: 'sensitive',
      sensitivity_level: 'high',
      reaction_history: {
        entries: [
          {
            trigger: 'fragrance',
            reaction_types: ['redness', 'stinging'],
          },
        ],
      },
      shopping_preferences: { ingredient_dislikes: ['fragrance'] },
    } as unknown as SkinProfile;
    inputs.contextSummary.skinProfile.skinType = 'sensitive';
    inputs.contextSummary.skinProfile.sensitivityLevel = 'high';
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Night Serum', ProductCategory.Treatment, {
        introduction_status: null,
      }),
    );
    inputs.contextSummary.productScores.push(
      productScore('retinoid-1', ProductCategory.Treatment, 90, [
        'retinoid',
        'retinol',
      ]),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'retinoid-1' }),
      ]),
    );
    expect(result.explanation.body.join(' ').toLowerCase()).not.toContain(
      'retinol',
    );
    expect(result.explanation.headline.toLowerCase()).not.toContain('retinol');
    expect(
      result.steps
        .map((step) => step.explanation)
        .join(' ')
        .toLowerCase(),
    ).not.toContain('retinol');
  });

  it('removes a step that is actually copy for later use instead of falling back', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Noon support',
                    body: ['Use sunscreen now.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'spf-1', ProductCategory.SunProtection),
                    {
                      ...aiProductStep(
                        1,
                        'moisturizer-1',
                        ProductCategory.Moisturizer,
                      ),
                      explanation: 'Keep this for later.',
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Noon),
    );

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'spf-1',
    ]);
  });

  it('removes daytime high-UV strong actives instead of falling back', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Midday sun support',
                    body: ['High UV today, so sunscreen comes first.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'spf-1', ProductCategory.SunProtection),
                    aiProductStep(1, 'retinoid-1', ProductCategory.Treatment),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Noon);
    inputs.contextSummary.safetyConstraints.push('space_strong_actives');
    inputs.contextSummary.environment = highUvEnvironment();
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Night Serum', ProductCategory.Treatment),
    );
    inputs.contextSummary.productScores.push(
      productScore('retinoid-1', ProductCategory.Treatment, 90, [
        'retinoid',
        'retinol',
      ]),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'spf-1' }),
      ]),
    );
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'retinoid-1' }),
      ]),
    );
  });

  it('removes strong actives selected too soon after another strong active instead of falling back', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening pores',
                    body: ['Use BHA for clogged pores.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'bha-1', ProductCategory.Exfoliant),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.targetDate = '2026-05-18';
    inputs.contextSummary.targetDate = '2026-05-18';
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Night Serum', ProductCategory.Treatment),
      product('bha-1', 'BHA 2% Liquid', ProductCategory.Exfoliant),
    );
    inputs.contextSummary.productScores.push(
      productScore('retinoid-1', ProductCategory.Treatment, 90, ['retinoid']),
      productScore('bha-1', ProductCategory.Exfoliant, 88, ['bha']),
    );
    inputs.contextSummary.safetyConstraints.push('space_strong_actives');
    inputs.contextSummary.appliedProductHistory = {
      windowStartDate: '2026-04-19',
      windowEndDate: '2026-05-18',
      recordsConsidered: 30,
      products: [
        {
          productId: 'retinoid-1',
          brand: 'Ava Lab',
          name: 'Retinol Night Serum',
          category: ProductCategory.Treatment,
          stepLabel: ProductCategory.Treatment,
          sourceTypes: ['recommended'],
          dayparts: ['evening'],
          statuses: ['applied'],
          useCount: 1,
          lastAppliedDate: '2026-05-17',
          lastAppliedAt: '2026-05-17T20:00:00.000Z',
          isOffShelf: false,
          isSubstitution: false,
        },
      ],
    };

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'bha-1' }),
      ]),
    );
  });

  it('accepts tolerated retinol when sparse application logs do not show reaction or recent strong-active spacing', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening renewal',
                    body: ['Use the tolerated shelf treatment tonight.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'retinoid-1', ProductCategory.Treatment),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.contextSummary.applicationPatterns.conservativeRestart = true;
    inputs.contextSummary.safetyConstraints = [];
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Night Serum', ProductCategory.Treatment),
    );
    inputs.contextSummary.productScores.push(
      productScore('retinoid-1', ProductCategory.Treatment, 90, ['retinoid']),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'retinoid-1' }),
      ]),
    );
  });

  it('keeps tolerated retinol when the only recent strong-active exposure was an exfoliating cleanser', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening mark support',
                    body: ['Use the tolerated retinol tonight.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'sa-cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'retinoid-1', ProductCategory.Treatment),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.targetDate = '2026-05-18';
    inputs.contextSummary.targetDate = '2026-05-18';
    inputs.shelfActiveProducts.push(
      product(
        'sa-cleanser-1',
        'SA Smoothing Cleanser',
        ProductCategory.Cleanser,
      ),
      product('retinoid-1', 'Retinol Night Serum', ProductCategory.Treatment),
    );
    inputs.contextSummary.productScores.push(
      productScore('sa-cleanser-1', ProductCategory.Cleanser, 86, ['bha']),
      productScore('retinoid-1', ProductCategory.Treatment, 90, ['retinoid']),
    );
    inputs.contextSummary.safetyConstraints.push('space_strong_actives');
    inputs.contextSummary.appliedProductHistory = {
      windowStartDate: '2026-04-19',
      windowEndDate: '2026-05-18',
      recordsConsidered: 30,
      products: [
        {
          productId: 'sa-cleanser-1',
          brand: 'CeraVe',
          name: 'SA Smoothing Cleanser',
          category: ProductCategory.Cleanser,
          stepLabel: ProductCategory.Cleanser,
          sourceTypes: ['recommended'],
          dayparts: ['evening'],
          statuses: ['applied'],
          useCount: 1,
          lastAppliedDate: '2026-05-17',
          lastAppliedAt: '2026-05-17T20:00:00.000Z',
          isOffShelf: false,
          isSubstitution: false,
        },
      ],
    };

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'retinoid-1' }),
      ]),
    );
  });

  it('does not reject retinol from the AI path solely because the slot is daytime', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning plan',
                    body: ['Use eligible shelf products for this slot.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'retinoid-1', ProductCategory.Treatment),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(3, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.contextSummary.safetyConstraints = ['daytime_spf_available'];
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Treatment', ProductCategory.Treatment),
    );
    inputs.contextSummary.productScores.push(
      productScore('retinoid-1', ProductCategory.Treatment, 90, ['retinoid']),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'retinoid-1' }),
      ]),
    );
  });

  it('does not deterministically add a goal-support product when OpenAI returns only basics', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Calm acne night',
                    body: ['Keep the routine simple tonight.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      primary_goal: 'reduce breakouts',
      current_concerns: ['acne', 'clogged pores'],
      routine_preferences: { pm_minutes: 10 },
    } as SkinProfile;
    inputs.contextSummary.skinProfile.primaryGoal = 'reduce breakouts';
    inputs.contextSummary.skinProfile.activeConcerns = [
      'acne',
      'clogged pores',
    ];
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.map((score) =>
        score.productId === 'serum-1'
          ? {
              ...score,
              suitabilityScore: 96,
              activeTags: ['niacinamide'],
              suitabilityReasons: [
                'matches this slot',
                'primary selected goal',
              ],
            }
          : score,
      );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
    ]);
  });

  it('does not let goal-support repair re-add an unsupported product and force fallback', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning basics',
                    body: ['Keep the routine safe and simple this morning.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(2, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.skinProfile = {
      primary_goal: 'reduce breakouts',
      current_concerns: ['acne', 'clogged pores'],
    } as SkinProfile;
    inputs.contextSummary.skinProfile.primaryGoal = 'reduce breakouts';
    inputs.contextSummary.skinProfile.activeConcerns = [
      'acne',
      'clogged pores',
    ];
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.map((score) =>
        score.productId === 'serum-1'
          ? {
              ...score,
              suitabilityScore: 96,
              activeTags: ['niacinamide'],
              suitabilityReasons: ['primary selected goal'],
              cautionReasons: ['recent reaction-related skip by user'],
            }
          : score,
      );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('removes unsupported sensitive profile claims from AI explanation inputs', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning base',
                    body: ['Cleanse and moisturize.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [
                      {
                        label: 'Skin',
                        detail:
                          'Combination skin; tone=deep; ethnicity=Black; countryCode=SE; city=Stockholm; fitzpatrickPhototype=IV; high PIH tendency',
                      },
                      { label: 'ethnicity', detail: 'Black' },
                      { label: 'fitzpatrickPhototype', detail: 'IV' },
                    ],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);

    const result = await generator.generate(inputs);

    expect(result.explanation.inputs).toEqual([
      {
        label: 'Skin',
        detail: 'Combination skin',
      },
    ]);
  });

  it('falls back when OpenAI selects a product outside its user-preferred time', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning serum',
                    body: ['Use the serum now.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    {
                      stepOrder: 0,
                      routineStepId: null,
                      inventoryProductId: 'serum-1',
                      productBrand: 'Ava Lab',
                      productName: 'Niacinamide Serum',
                      stepLabel: ProductCategory.Serum,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Use this serum now.',
                      provenance: SuggestionStepProvenance.AiAdded,
                      chips: [],
                      safetyWarnings: [],
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    const serum = inputs.shelfActiveProducts.find(
      (productValue) => productValue.id === 'serum-1',
    );
    if (!serum) throw new Error('Expected serum fixture.');
    serum.user_fields = {
      preferredTimeOfDay: PreferredTimeOfDay.Evening,
    } as InventoryProduct['user_fields'];
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.map((score) =>
        score.productId === 'serum-1'
          ? {
              ...score,
              preferredTimeOfDay: PreferredTimeOfDay.Evening,
              cautionReasons: [
                'preferred time of day does not match this slot',
              ],
            }
          : score,
      );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'serum-1' }),
      ]),
    );
  });

  it('removes a morning-preferred product selected at night instead of falling back', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Night serum',
                    body: ['Use the serum tonight.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    {
                      stepOrder: 0,
                      routineStepId: null,
                      inventoryProductId: 'serum-1',
                      productBrand: 'Ava Lab',
                      productName: 'Niacinamide Serum',
                      stepLabel: ProductCategory.Serum,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Use this serum tonight.',
                      provenance: SuggestionStepProvenance.AiAdded,
                      chips: [],
                      safetyWarnings: [],
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    const serum = inputs.shelfActiveProducts.find(
      (productValue) => productValue.id === 'serum-1',
    );
    if (!serum) throw new Error('Expected serum fixture.');
    serum.user_fields = {
      preferredTimeOfDay: PreferredTimeOfDay.Morning,
    } as InventoryProduct['user_fields'];
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.map((score) =>
        score.productId === 'serum-1'
          ? {
              ...score,
              preferredTimeOfDay: PreferredTimeOfDay.Morning,
              cautionReasons: [
                'preferred time of day does not match this slot',
              ],
            }
          : score,
      );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'serum-1' }),
      ]),
    );
  });

  it('keeps owned SPF in minimal daytime on-demand baseline suggestions', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Noon);
    inputs.requestSource = SuggestionRequestSource.OnDemand;
    inputs.requestContext = {
      intent: 'post_workout',
      intensity: 'minimal',
      note: 'Sweaty after gym, need something quick.',
      activityAt: '2026-04-29T12:30:00.000Z',
      requestedAt: '2026-04-29T13:00:00.000Z',
    };

    const result = await generator.generate(inputs);

    expect(result.steps.length).toBeLessThanOrEqual(3);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'spf-1' }),
      ]),
    );
  });

  it('does not add a sunscreen gap in high-UV fallback when owned SPF is selected', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Noon);
    inputs.contextSummary.environment = highUvEnvironment();

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'spf-1' }),
      ]),
    );
    expect(result.gapRecommendations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory: expect.stringMatching(/spf|sunscreen/i),
        }),
      ]),
    );
  });

  it('adds deterministic high-UV evidence even when OpenAI already selects owned SPF', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Noon SPF',
                    body: ['Use your sunscreen now.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    {
                      stepOrder: 0,
                      routineStepId: null,
                      inventoryProductId: 'spf-1',
                      productBrand: 'Ava Lab',
                      productName: 'Daily SPF 50',
                      stepLabel: ProductCategory.SunProtection,
                      customLabel: null,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Use owned SPF for noon UV.',
                      provenance: SuggestionStepProvenance.AiAdded,
                      chips: [],
                      safetyWarnings: [],
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Noon);
    inputs.contextSummary.environment = highUvEnvironment();
    inputs.contextSummary.evidenceSources = getSuggestionEvidenceSources([
      SuggestionEvidenceSourceId.OpenMeteoWeather,
      SuggestionEvidenceSourceId.AadSunscreenSelection,
      SuggestionEvidenceSourceId.MayoDrySkinCare,
    ]);

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.safetyFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('UV is high today'),
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.OpenMeteoWeather,
            SuggestionEvidenceSourceId.AadSunscreenSelection,
          ]),
        }),
      ]),
    );
  });

  it('filters optional treatment gaps when the immediate owned routine is complete', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Noon SPF',
                    body: ['Use moisturizer and SPF now.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(
                      0,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(1, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [
                    {
                      ingredientOrCategory: 'azelaic acid',
                      reason: 'Helpful for dark marks.',
                      budgetTier: 'mid',
                      goalAlignment: 'pigment support',
                      sourceIds: [
                        SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
                      ],
                    },
                  ],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Noon);
    inputs.contextSummary.environment = highUvEnvironment();

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.gapRecommendations).toEqual([]);
  });

  it('keeps scheduled minimal beginner baseline suggestions to basics', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.skinProfile = {
      routine_preferences: { pace: 'minimal', am_minutes: 5 },
    } as unknown as SkinProfile;

    const result = await generator.generate(inputs);

    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('repairs OpenAI minimal beginner output when an optional serum replaces eligible support', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Simple morning with SPF',
                    body: ['Short morning routine for dryness and pores.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'serum-1', ProductCategory.Serum),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(2, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.skinProfile = {
      routine_preferences: { pace: 'minimal', am_minutes: 5 },
    } as unknown as SkinProfile;

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'serum-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('repairs underfilled scheduled morning AI output that omits eligible cleanser', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Simple morning with SPF',
                    body: ['Short morning routine.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(
                      0,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(1, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('repairs active plus SPF morning output without adding a separated serum companion', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning tone support',
                    body: ['Use vitamin C and SPF this morning.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'vitamin-c-1', ProductCategory.Serum),
                    aiProductStep(1, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.shelfActiveProducts.push(
      product('vitamin-c-1', 'Vitamin C Serum', ProductCategory.Serum),
    );
    inputs.contextSummary.productScores.push(
      productScore('vitamin-c-1', ProductCategory.Serum, 96, ['vitamin_c']),
    );
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.map((score) =>
        score.productId === 'serum-1'
          ? {
              ...score,
              cautionReasons: [
                'Avoid layering this niacinamide serum with Vitamin C Serum in the same routine.',
              ],
            }
          : score,
      );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'vitamin-c-1',
      'spf-1',
    ]);
    expect(result.steps.map((step) => step.inventoryProductId)).not.toContain(
      'serum-1',
    );
  });

  it('repairs OpenAI output that combines products with ingredient-analysis conflicts', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening active support',
                    body: ['Use the shelf products that best fit tonight.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'retinoid-1', ProductCategory.Treatment),
                    aiProductStep(2, 'aha-1', ProductCategory.Toner),
                    aiProductStep(
                      3,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Treatment', ProductCategory.Treatment),
      product('aha-1', 'Glycolic Acid Toner', ProductCategory.Toner),
    );
    const ingredientConflict = ingredientConflictSummary(
      'RETINOID_AHA',
      'retinoid-1',
      'aha-1',
    );
    inputs.contextSummary.productScores = [
      productScore('cleanser-1', ProductCategory.Cleanser, 88, []),
      {
        ...productScore('retinoid-1', ProductCategory.Treatment, 96, [
          'retinoid',
        ]),
        ingredientConflicts: [ingredientConflict],
      },
      {
        ...productScore('aha-1', ProductCategory.Toner, 90, ['aha']),
        ingredientConflicts: [ingredientConflict],
      },
      productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
        'ceramide',
      ]),
    ];

    const result = await generator.generate(inputs);
    const productIds = result.steps
      .map((step) => step.inventoryProductId)
      .filter((productId): productId is string => Boolean(productId));

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(productIds).toEqual(expect.arrayContaining(['retinoid-1']));
    expect(productIds).not.toEqual(
      expect.arrayContaining(['retinoid-1', 'aha-1']),
    );
  });

  it('replaces a lower-scored separated serum with the stronger current fit', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning tone support',
                    body: ['Use niacinamide for even tone.'],
                    perStepReasons: [],
                    skipped: [
                      {
                        name: 'Ava Lab Vitamin C Serum',
                        reason: 'Pairing caution with niacinamide.',
                      },
                    ],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'serum-1', ProductCategory.Serum),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(3, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.shelfActiveProducts.push(
      product('vitamin-c-1', 'Vitamin C Serum', ProductCategory.Serum),
    );
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.map((score) =>
        score.productId === 'serum-1'
          ? {
              ...score,
              suitabilityScore: 82,
              cautionReasons: [
                'Avoid layering this niacinamide serum with Vitamin C Serum in the same routine.',
              ],
            }
          : score,
      );
    inputs.contextSummary.productScores.push(
      productScore('vitamin-c-1', ProductCategory.Serum, 96, ['vitamin_c']),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'vitamin-c-1',
      'moisturizer-1',
      'spf-1',
    ]);
    expect(result.explanation.skipped).toEqual([]);
  });

  it('allows OpenAI to add a product with current goal evidence', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning plan',
                    body: ['Keep SPF consistent and add tone support.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'serum-1', ProductCategory.Serum),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(3, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    addStableSameDaypartRepeatMemory(inputs);
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.map((score) =>
        score.productId === 'serum-1'
          ? {
              ...score,
              suitabilityReasons: [
                ...score.suitabilityReasons,
                'supports main skin profile goal',
              ],
            }
          : score,
      );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'serum-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('keeps an AI-selected owned product when no safety or timing rule blocks it', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning plan',
                    body: ['Keep SPF consistent and add tone support.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'mask-1', ProductCategory.Mask),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(3, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    addStableSameDaypartRepeatMemory(inputs);
    inputs.shelfActiveProducts.push(
      product('mask-1', 'Glow Mask', ProductCategory.Mask),
    );
    inputs.contextSummary.productScores.push(
      productScore('mask-1', ProductCategory.Mask, 82, ['fragrance']),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'mask-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('uses refreshed shelf scoring when cached score context is stale', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Tone support today',
                    body: ['Use the shelf product that fits the pigment goal.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'serum-1', ProductCategory.Serum),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(3, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.skinProfile = {
      primary_goal: 'fade post-acne dark marks',
      current_concerns: ['dark marks'],
    } as unknown as SkinProfile;
    inputs.contextSummary.skinProfile.primaryGoal = 'fade post-acne dark marks';
    inputs.contextSummary.skinProfile.activeConcerns = ['dark marks'];
    const serum = inputs.shelfActiveProducts.find(
      (productValue) => productValue.id === 'serum-1',
    );
    if (!serum) throw new Error('Missing serum fixture');
    serum.identity = {
      inciIngredients: ['Niacinamide'],
      benefits: ['dark marks', 'uneven tone'],
    } as InventoryProduct['identity'];
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.map((score) =>
        score.productId === 'serum-1'
          ? {
              ...score,
              activeTags: [],
              suitabilityReasons: ['stale cached score'],
              dataQuality: 'partial',
            }
          : score,
      );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'serum-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('keeps safe AI-selected steps when a productless routine placeholder cannot recover an unsafe AI output', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning plan',
                    body: ['Keep SPF consistent and add unsupported novelty.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'mask-1', ProductCategory.Mask),
                    aiProductStep(1, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.routineSteps = [
      {
        id: 'placeholder-cleanser',
        slot_id: 'slot-1',
        step_order: 0,
        inventory_product_id: null,
        step_label: ProductCategory.Cleanser,
        custom_label: null,
        notes: null,
        optional: false,
        is_specialist_locked: false,
        product: null,
      } as RoutineStep,
    ];
    inputs.shelfActiveProducts.push(
      product('mask-1', 'Glow Mask', ProductCategory.Mask),
    );
    inputs.contextSummary.productScores.push(
      productScore('mask-1', ProductCategory.Mask, 82, ['fragrance']),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'mask-1',
      'spf-1',
    ]);
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: null }),
      ]),
    );
  });

  it('keeps fallback non-empty when cached context marked repeated basics as recent repeats', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning plan',
                    body: ['Keep SPF consistent and add tone support.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'mask-1', ProductCategory.Mask),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(3, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    addStableSameDaypartRepeatMemory(inputs);
    inputs.shelfActiveProducts.push(
      product('mask-1', 'Glow Mask', ProductCategory.Mask),
    );
    inputs.contextSummary.productScores.push(
      productScore('mask-1', ProductCategory.Mask, 82, ['fragrance']),
    );
    inputs.contextSummary.skippedCandidates = [
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ].map((productId) => ({
      productId,
      reason: 'recent same-daypart repeat',
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
    }));

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'mask-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('does not use applied history alone as product selection evidence', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning plan',
                    body: ['Keep SPF consistent and include familiar serum.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'history-serum-only',
                      ProductCategory.Serum,
                    ),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(3, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    addStableSameDaypartRepeatMemory(inputs);
    inputs.contextSummary.appliedProductHistory?.products.push({
      productId: 'history-serum-only',
      brand: 'Ava Lab',
      name: 'Old Niacinamide Serum',
      category: ProductCategory.Serum,
      stepLabel: ProductCategory.Serum,
      sourceTypes: ['user_added'],
      dayparts: [SuggestionDaypart.Morning],
      statuses: ['applied'],
      useCount: 5,
      lastAppliedDate: '2026-04-27',
      lastAppliedAt: '2026-04-27T08:01:00.000Z',
      isOffShelf: false,
      isSubstitution: false,
    });

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('keeps deterministic fallback data-led instead of basic-only', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    addStableSameDaypartRepeatMemory(inputs);

    const result = await generator.generate(inputs);

    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'serum-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('does not select products already marked as skipped candidates in baseline fallback', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Night Serum', ProductCategory.Treatment),
    );
    inputs.contextSummary.productScores.push(
      productScore('retinoid-1', ProductCategory.Treatment, 90, ['retinoid']),
    );
    inputs.contextSummary.skippedCandidates = [
      {
        productId: 'retinoid-1',
        reason: 'Strong active should be spaced carefully tonight.',
        sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
      },
    ];

    const result = await generator.generate(inputs);

    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'retinoid-1' }),
      ]),
    );
    expect(result.explanation.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.stringContaining('retinoid-1'),
        }),
      ]),
    );
  });

  it('does not reintroduce a paused product from stale score context', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.shelfActiveProducts.push(
      product(
        'paused-treatment-1',
        'Paused Treatment',
        ProductCategory.Treatment,
        {
          introduction_status: ProductIntroductionStatus.Paused,
        },
      ),
    );
    inputs.contextSummary.productScores.push(
      productScore('paused-treatment-1', ProductCategory.Treatment, 99, [
        'azelaic_acid',
      ]),
    );
    inputs.contextSummary.skippedCandidates = [
      {
        productId: 'paused-treatment-1',
        brand: 'Ava Lab',
        name: 'Paused Treatment',
        category: ProductCategory.Treatment,
        introductionStatus: ProductIntroductionStatus.Paused,
        reason: 'product introduction is paused',
        sourceIds: [],
      },
    ];

    const result = await generator.generate(inputs);

    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'paused-treatment-1' }),
      ]),
    );
    expect(result.explanation.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Ava Lab Paused Treatment',
          reason: expect.stringContaining('paused'),
        }),
      ]),
    );
  });

  it('does not use a routine product whose paused shelf relation is not loaded', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.shelfActiveProducts.push(
      product(
        'paused-routine-product',
        'Paused Routine Serum',
        ProductCategory.Serum,
        {
          introduction_status: ProductIntroductionStatus.Paused,
        },
      ),
    );
    inputs.routineSteps = [
      {
        id: 'paused-routine-step',
        slot_id: 'slot-1',
        step_order: 0,
        inventory_product_id: 'paused-routine-product',
        step_label: ProductCategory.Serum,
        custom_label: null,
        notes: null,
        optional: false,
        is_specialist_locked: true,
        product: null,
      } as RoutineStep,
    ];

    const result = await generator.generate(inputs);

    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'paused-routine-product',
        }),
      ]),
    );
  });

  it('normalizes duplicate step orders when AI adds steps around a locked routine step', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening plan',
                    body: ['Cleanse, keep the locked serum, then moisturize.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    {
                      ...aiProductStep(0, 'serum-1', ProductCategory.Serum),
                      routineStepId: 'locked-serum-step',
                      provenance: SuggestionStepProvenance.SpecialistLocked,
                    },
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    const serumProduct = inputs.shelfActiveProducts.find(
      (productValue) => productValue.id === 'serum-1',
    );
    if (!serumProduct) throw new Error('serum fixture missing');
    inputs.routineSteps = [
      {
        ...routineStep('locked-serum-step', 0, serumProduct),
        is_specialist_locked: true,
      } as RoutineStep,
    ];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.stepOrder)).toEqual([0, 1, 2]);
    expect(new Set(result.steps.map((step) => step.stepOrder)).size).toBe(
      result.steps.length,
    );
    expect(result.steps[1]).toEqual(
      expect.objectContaining({
        routineStepId: 'locked-serum-step',
        provenance: SuggestionStepProvenance.SpecialistLocked,
      }),
    );
  });

  it('removes AI-added earlier-use steps after a specialist-locked treatment', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening plan',
                    body: ['Follow the locked treatment and support barrier.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    {
                      ...aiProductStep(
                        0,
                        'rx-adapalene-1',
                        ProductCategory.Treatment,
                      ),
                      routineStepId: 'locked-adapalene-step',
                      provenance: SuggestionStepProvenance.SpecialistLocked,
                    },
                    aiProductStep(1, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    const adapalene = product(
      'rx-adapalene-1',
      'Adapalene Gel',
      ProductCategory.Treatment,
    );
    inputs.shelfActiveProducts.push(adapalene);
    inputs.contextSummary.productScores.push(
      productScore('rx-adapalene-1', ProductCategory.Treatment, 94, [
        'retinoid',
        'adapalene',
      ]),
    );
    inputs.routineSteps = [
      {
        ...routineStep('locked-adapalene-step', 0, adapalene),
        is_specialist_locked: true,
      } as RoutineStep,
    ];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'rx-adapalene-1',
      'moisturizer-1',
    ]);
    expect(result.steps.map((step) => step.stepOrder)).toEqual([0, 1]);
  });

  it('repairs OpenAI output that drops an eligible manual routine step', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning barrier and SPF',
                    body: ['Keep the morning routine simple.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'serum-1', ProductCategory.Serum),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    {
                      ...aiProductStep(
                        2,
                        'spf-1',
                        ProductCategory.SunProtection,
                      ),
                      routineStepId: 'manual-spf-step',
                      provenance: SuggestionStepProvenance.UserRoutine,
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.routineSteps = [
      routineStep('manual-cleanser-step', 0, inputs.shelfActiveProducts[0]),
      routineStep('manual-spf-step', 1, inputs.shelfActiveProducts[3]),
    ];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routineStepId: 'manual-cleanser-step',
          inventoryProductId: 'cleanser-1',
          provenance: SuggestionStepProvenance.UserRoutine,
        }),
      ]),
    );
  });

  it('repairs missing owned barrier support without changing manual product choices', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning plan',
                    body: [],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    {
                      stepOrder: 0,
                      routineStepId: 'manual-cleanser-step',
                      inventoryProductId: 'cleanser-1',
                      productBrand: 'Ava Lab',
                      productName: 'Soft Cleanser',
                      stepLabel: ProductCategory.Cleanser,
                      customLabel: null,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Cleanse first.',
                      provenance: SuggestionStepProvenance.UserRoutine,
                      chips: [],
                      safetyWarnings: [],
                    },
                    {
                      stepOrder: 1,
                      routineStepId: 'manual-spf-step',
                      inventoryProductId: 'spf-1',
                      productBrand: 'Ava Lab',
                      productName: 'Daily SPF 50',
                      stepLabel: ProductCategory.SunProtection,
                      customLabel: null,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Finish with SPF.',
                      provenance: SuggestionStepProvenance.UserRoutine,
                      chips: [],
                      safetyWarnings: [],
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.skinProfile = {
      primary_goal: 'support barrier while using sunscreen',
      current_concerns: ['dryness'],
    } as unknown as SkinProfile;
    inputs.contextSummary.skinProfile.primaryGoal =
      'support barrier while using sunscreen';
    inputs.contextSummary.skinProfile.activeConcerns = ['dryness'];
    inputs.routineSteps = [
      routineStep('manual-cleanser-step', 0, inputs.shelfActiveProducts[0]),
      routineStep('manual-spf-step', 1, inputs.shelfActiveProducts[3]),
    ];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.mode).toBe(SuggestionMode.Mixed);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routineStepId: 'manual-cleanser-step',
          inventoryProductId: 'cleanser-1',
          provenance: SuggestionStepProvenance.UserRoutine,
        }),
        expect.objectContaining({
          routineStepId: 'manual-spf-step',
          inventoryProductId: 'spf-1',
          provenance: SuggestionStepProvenance.UserRoutine,
        }),
        expect.objectContaining({
          routineStepId: null,
          inventoryProductId: 'moisturizer-1',
          provenance: SuggestionStepProvenance.AiAdded,
        }),
      ]),
    );
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('filters irrelevant evening sunscreen gaps when no photosensitizing active is selected', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening barrier',
                    body: [],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    {
                      stepOrder: 0,
                      routineStepId: null,
                      inventoryProductId: 'moisturizer-1',
                      productBrand: 'Ava Lab',
                      productName: 'Barrier Cream',
                      stepLabel: ProductCategory.Moisturizer,
                      customLabel: null,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Support the barrier tonight.',
                      provenance: 'ai_added',
                      chips: [],
                      safetyWarnings: [],
                    },
                  ],
                  gapRecommendations: [
                    {
                      ingredientOrCategory: 'Sunscreen',
                      reason: 'No sunscreen for daytime UV protection.',
                      budgetTier: 'starter',
                      goalAlignment: 'Sun protection',
                      sourceIds: [
                        SuggestionEvidenceSourceId.AadSunscreenSelection,
                      ],
                    },
                  ],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Evening),
    );

    expect(result.gapRecommendations).toEqual([]);
  });

  it('filters treatment product gaps while a reaction or barrier signal is active', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: true,
                  explanation: {
                    headline: 'Barrier reset',
                    body: ['Keep this gentle while skin is reactive.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [
                    {
                      ingredientOrCategory: 'Azelaic acid',
                      reason: 'Gentler acne support once the reaction settles.',
                      budgetTier: 'mid',
                      goalAlignment: 'acne and pigment support',
                      sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
                    },
                  ],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.contextSummary.reaction = {
      ...inputs.contextSummary.reaction,
      hasSignal: true,
      severity: 'moderate',
      confidence: 0.9,
      indicators: ['stinging', 'redness'],
      barrierCompromised: true,
    };

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.gapRecommendations).toEqual([]);
  });

  it('repairs explanation copy that says only while multiple steps are selected', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Gentle restart',
                    body: ['Use moisturizer only tonight.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    {
                      stepOrder: 0,
                      routineStepId: null,
                      inventoryProductId: 'cleanser-1',
                      productBrand: 'Ava Lab',
                      productName: 'Soft Cleanser',
                      stepLabel: ProductCategory.Cleanser,
                      customLabel: null,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Gentle cleanse.',
                      provenance: 'ai_added',
                      chips: [],
                      safetyWarnings: [],
                    },
                    {
                      stepOrder: 1,
                      routineStepId: null,
                      inventoryProductId: 'moisturizer-1',
                      productBrand: 'Ava Lab',
                      productName: 'Barrier Cream',
                      stepLabel: ProductCategory.Moisturizer,
                      customLabel: null,
                      applicationMethod: null,
                      quantity: null,
                      waitAfterMinutes: null,
                      explanation: 'Barrier support.',
                      provenance: 'ai_added',
                      chips: [],
                      safetyWarnings: [],
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Evening),
    );

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.explanation.body.join(' ')).not.toMatch(/\bonly\b/i);
    expect(result.explanation.body).toContain('Use moisturizer tonight.');
  });

  it('falls back when no-shelf copy describes missing products as steps', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Start with sunscreen',
                    body: [
                      'Sunscreen is the main step for daytime protection.',
                    ],
                    perStepReasons: [
                      {
                        stepOrder: 1,
                        reason:
                          'Morning UV protection is the safest first step.',
                      },
                    ],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [],
                  gapRecommendations: [
                    {
                      ingredientOrCategory: 'Broad-spectrum SPF 30+ sunscreen',
                      reason: 'Needed for morning protection.',
                      budgetTier: 'starter',
                      goalAlignment: 'safe routine start',
                      sourceIds: [
                        SuggestionEvidenceSourceId.AadSunscreenSelection,
                      ],
                    },
                  ],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.shelfActiveProducts = [];
    inputs.contextSummary.productScores = [];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('no_shelf_gap_only_copy');
    expect(result.steps).toEqual([]);
    expect(result.explanation.headline).toBe('No shelf steps yet');
  });

  it('uses OpenAI gap wording for empty shelves when the output does not invent steps', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Start with the basics',
                    body: ['Add moisturizer and SPF to start safely.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [],
                  gapRecommendations: [
                    {
                      ingredientOrCategory: 'broad-spectrum SPF 30+ sunscreen',
                      reason: 'Morning use fits daytime UV protection.',
                      budgetTier: 'starter',
                      goalAlignment: 'safe routine start',
                      sourceIds: [
                        SuggestionEvidenceSourceId.AadSunscreenSelection,
                      ],
                    },
                  ],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.shelfActiveProducts = [];
    inputs.contextSummary.productScores = [];

    const result = await generator.generate(inputs);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toEqual([]);
    expect(result.gapRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory: expect.stringContaining('SPF'),
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.AadSunscreenSelection,
          ]),
        }),
      ]),
    );
    expect(result.explanation.body).toEqual(
      expect.arrayContaining(['Add moisturizer and SPF to start safely.']),
    );
  });

  it('explains zero-step quick suggestions without claiming the shelf is empty', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    const eveningIncompatibleSpf = product(
      'spf-1',
      'Daily SPF 50',
      ProductCategory.SunProtection,
    );
    inputs.requestSource = SuggestionRequestSource.OnDemand;
    inputs.requestContext = {
      intent: 'quick_refresh',
      intensity: 'minimal',
      note: 'Skin feels comfortable and I am staying indoors. Do I need anything else?',
      activityAt: null,
      requestedAt: '2026-04-29T20:30:00.000Z',
    };
    inputs.targetTime = '20:30';
    inputs.contextSummary.requestSource = SuggestionRequestSource.OnDemand;
    inputs.contextSummary.onDemand = inputs.requestContext;
    inputs.contextSummary.targetTime = '20:30';
    inputs.shelfActiveProducts = [eveningIncompatibleSpf];
    inputs.contextSummary.productScores = [
      {
        ...productScore('spf-1', ProductCategory.SunProtection, 92, ['spf']),
        preferredTimeOfDay: PreferredTimeOfDay.Morning,
      },
    ];
    inputs.contextSummary.safetyConstraints = [];

    const result = await generator.generate(inputs);

    expect(result.steps).toEqual([]);
    expect(result.gapRecommendations).toEqual([]);
    expect(result.explanation.headline).toBe('No extra step needed');
    expect(result.explanation.body.join(' ')).toContain(
      'Your shelf products are better saved for their preferred time.',
    );
    expect(result.explanation.body.join(' ')).not.toContain(
      'No active shelf products are available',
    );
  });

  it('does not treat missing score context as an empty shelf when active products exist', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Using shelf safely',
                    body: ['Morning basics from your shelf.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(2, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.contextSummary.productScores = [];

    const result = await generator.generate(inputs);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'cleanser-1',
          stepLabel: ProductCategory.Cleanser,
        }),
        expect.objectContaining({
          inventoryProductId: 'moisturizer-1',
          stepLabel: ProductCategory.Moisturizer,
        }),
        expect.objectContaining({
          inventoryProductId: 'spf-1',
          stepLabel: ProductCategory.SunProtection,
        }),
      ]),
    );
  });

  it('builds safe deterministic shelf steps when OpenAI fails and score context is missing', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.contextSummary.productScores = [];

    const result = await generator.generate(inputs);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('provider_failure');
    expect(result.explanation.headline).toBe('Using your shelf today');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'cleanser-1',
          stepLabel: ProductCategory.Cleanser,
        }),
        expect.objectContaining({
          inventoryProductId: 'moisturizer-1',
          stepLabel: ProductCategory.Moisturizer,
        }),
        expect.objectContaining({
          inventoryProductId: 'spf-1',
          stepLabel: ProductCategory.SunProtection,
        }),
      ]),
    );
    expect(result.gapRecommendations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory: expect.stringContaining('sunscreen'),
        }),
      ]),
    );
    expect(result.safetyFlags).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientSlugs: expect.arrayContaining(['spf']),
        }),
      ]),
    );
  });

  it('retries scheduled provider failures within the Today timeout budget', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient provider failure'))
      .mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    simplifiedForReaction: false,
                    explanation: {
                      headline: 'Morning shelf plan',
                      body: ['Use the best-fitting shelf steps.'],
                      perStepReasons: [],
                      skipped: [],
                      inputs: [],
                    },
                    steps: [
                      aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                      aiProductStep(
                        1,
                        'moisturizer-1',
                        ProductCategory.Moisturizer,
                      ),
                      aiProductStep(2, 'spf-1', ProductCategory.SunProtection),
                    ],
                    gapRecommendations: [],
                    safetyFlags: [],
                  }),
                },
              ],
            },
          ],
        }),
      });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Morning),
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
  });

  it('retries malformed scheduled structured output within the Today timeout budget', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(openAiTextResponse(agentPlan()))
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: '{"simplifiedForReaction":false,"explanation":',
                },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    simplifiedForReaction: false,
                    explanation: {
                      headline: 'Morning shelf plan',
                      body: ['Use the best-fitting shelf steps.'],
                      perStepReasons: [],
                      skipped: [],
                      inputs: [],
                    },
                    steps: [
                      aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                      aiProductStep(
                        1,
                        'moisturizer-1',
                        ProductCategory.Moisturizer,
                      ),
                      aiProductStep(2, 'spf-1', ProductCategory.SunProtection),
                    ],
                    gapRecommendations: [],
                    safetyFlags: [],
                  }),
                },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce(openAiTextResponse(agentPassingReview()));
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Morning),
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
  });

  it('does not retry quick suggestion provider failures', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Noon);
    inputs.requestSource = SuggestionRequestSource.OnDemand;
    inputs.requestContext = {
      intent: 'quick_refresh',
      intensity: 'minimal',
      note: 'Need a quick check.',
      activityAt: null,
      requestedAt: '2026-04-29T12:00:00.000Z',
    };
    inputs.contextSummary.requestSource = SuggestionRequestSource.OnDemand;
    inputs.contextSummary.onDemand = inputs.requestContext;

    const result = await generator.generate(inputs);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('provider_failure');
  });

  it('keeps scheduled fallback product-backed when the saved slot step no longer resolves to an eligible product', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('timeout'));
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.routineSteps = [
      {
        id: 'stale-slot-step',
        slot_id: 'slot-1',
        step_order: 0,
        inventory_product_id: 'deleted-product',
        step_label: ProductCategory.Treatment,
        custom_label: null,
        notes: null,
        optional: false,
        is_specialist_locked: false,
        product: null,
      } as RoutineStep,
    ];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('provider_failure');
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'cleanser-1',
          stepLabel: ProductCategory.Cleanser,
        }),
        expect.objectContaining({
          inventoryProductId: 'moisturizer-1',
          stepLabel: ProductCategory.Moisturizer,
        }),
      ]),
    );
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'deleted-product' }),
      ]),
    );
  });

  it('keeps fallback product-backed when skipped candidates are generic usage cautions', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.contextSummary.skippedCandidates =
      inputs.contextSummary.productScores.map((score) => ({
        productId: score.productId,
        reason:
          score.category === ProductCategory.SunProtection
            ? 'Keep babies and young children out of direct sunlight'
            : 'Avoid contact with eyes',
        sourceIds: score.evidenceSourceIds,
      }));

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'spf-1',
          stepLabel: ProductCategory.SunProtection,
        }),
        expect.objectContaining({
          inventoryProductId: 'moisturizer-1',
          stepLabel: ProductCategory.Moisturizer,
        }),
      ]),
    );
  });

  it('falls back to source-backed AI-mode product suggestions when OpenAI is unavailable', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Morning),
    );

    expect(result.mode).toBe('ai');
    expect(result.metadata.model).toBe('deterministic-baseline');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'cleanser-1',
          stepLabel: ProductCategory.Cleanser,
          provenance: 'ai_added',
        }),
        expect.objectContaining({
          inventoryProductId: 'spf-1',
          stepLabel: ProductCategory.SunProtection,
          provenance: 'ai_added',
        }),
      ]),
    );
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'serum-1' }),
      ]),
    );
    expect(result.explanation.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Evidence',
        }),
      ]),
    );
  });

  it('normalizes AI product labels and order when there is no manual routine', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Post workout',
                    body: ['Cleanse and protect after sweating.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'spf-1', ProductCategory.SunProtection),
                    {
                      ...aiProductStep(
                        1,
                        'cleanser-1',
                        ProductCategory.Cleanser,
                      ),
                      stepLabel: 'custom',
                    },
                    {
                      ...aiProductStep(
                        2,
                        'moisturizer-1',
                        ProductCategory.Moisturizer,
                      ),
                      stepLabel: 'custom',
                    },
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Noon),
    );

    expect(result.metadata.provider).toBe('openai');
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ]);
    expect(result.steps.map((step) => step.stepLabel)).toEqual([
      ProductCategory.Cleanser,
      ProductCategory.Moisturizer,
      ProductCategory.SunProtection,
    ]);
  });

  it('removes skipped copy for products repaired into selected steps', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Event prep',
                    body: ['Keep skin calm before dinner.'],
                    perStepReasons: [
                      { stepOrder: 0, reason: 'Cleanse gently.' },
                      { stepOrder: 1, reason: 'Support the barrier.' },
                    ],
                    skipped: [
                      {
                        name: 'Ava Lab Daily SPF 50',
                        reason: 'No daytime exposure is implied.',
                      },
                    ],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Noon),
    );

    expect(result.metadata.provider).toBe('openai');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'spf-1',
          stepLabel: ProductCategory.SunProtection,
        }),
      ]),
    );
    expect(result.explanation.skipped).toEqual([]);
    expect(result.explanation.perStepReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepOrder: 2,
          reason: 'Protects against UV, which can deepen dark marks.',
        }),
      ]),
    );
  });

  it('removes body copy that says a selected category was skipped', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Quick gym reset',
                    body: [
                      'Cleanse off sweat, then protect with SPF 50.',
                      'Skipped moisturizer to keep this quick.',
                    ],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(2, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Noon),
    );

    expect(result.metadata.provider).toBe('openai');
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ]);
    expect(result.explanation.body.join(' ')).not.toMatch(
      /skipped moisturizer/i,
    );
    expect(result.explanation.body).toContain(
      'Cleanse off sweat, then protect with SPF 50.',
    );
  });

  it('removes SPF gaps and conditional SPF copy when owned sunscreen is selected', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Post workout',
                    body: [
                      'Cleanse after sweating.',
                      'Use SPF if heading back into sunlight.',
                    ],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                    aiProductStep(2, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [
                    {
                      ingredientOrCategory: 'sunscreen',
                      reason: 'Use SPF if you will be outside.',
                      budgetTier: 'starter',
                      goalAlignment: 'daytime protection',
                      sourceIds: [
                        SuggestionEvidenceSourceId.AadSunscreenSelection,
                      ],
                    },
                  ],
                  safetyFlags: [
                    {
                      severity: 'info',
                      message:
                        'Daytime SPF is a good add if you will be in sunlight.',
                      ingredientSlugs: ['spf'],
                      sourceIds: [
                        SuggestionEvidenceSourceId.AadSunscreenSelection,
                      ],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);

    const result = await generator.generate(
      inputsWithScoredShelfProducts(SuggestionDaypart.Noon),
    );

    expect(result.metadata.provider).toBe('openai');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'spf-1',
          stepLabel: ProductCategory.SunProtection,
        }),
      ]),
    );
    expect(result.explanation.body).toEqual(['Cleanse after sweating.']);
    expect(result.gapRecommendations).toEqual([]);
    expect(result.safetyFlags).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('good add'),
        }),
      ]),
    );
  });

  it('adds recent strong-active spacing context when AI omits it', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening reset',
                    body: ['Strong actives are spaced tonight.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.targetDate = '2026-05-18';
    inputs.contextSummary.targetDate = '2026-05-18';
    inputs.shelfActiveProducts.push(
      product('retinoid-1', 'Retinol Night Serum', ProductCategory.Treatment),
    );
    inputs.contextSummary.productScores.push(
      productScore('retinoid-1', ProductCategory.Treatment, 90, ['retinoid']),
    );
    inputs.contextSummary.appliedProductHistory = {
      windowStartDate: '2026-04-19',
      windowEndDate: '2026-05-18',
      recordsConsidered: 30,
      products: [
        {
          productId: 'retinoid-1',
          brand: 'Ava Lab',
          name: 'Retinol Night Serum',
          category: ProductCategory.Treatment,
          stepLabel: ProductCategory.Treatment,
          sourceTypes: ['recommended'],
          dayparts: ['evening'],
          statuses: ['applied'],
          useCount: 1,
          lastAppliedDate: '2026-05-17',
          lastAppliedAt: '2026-05-17T20:00:00.000Z',
          isOffShelf: false,
          isSubstitution: false,
        },
      ],
    };
    inputs.contextSummary.skippedCandidates = [
      {
        productId: 'retinoid-1',
        reason: 'Strong active should be spaced carefully.',
        sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
      },
    ];
    inputs.contextSummary.safetyConstraints = ['space_strong_actives'];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.explanation.body).toEqual(
      expect.arrayContaining([expect.stringContaining('was used yesterday')]),
    );
    expect(result.explanation.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Ava Lab Retinol Night Serum',
          reason: expect.stringContaining('recent use'),
        }),
      ]),
    );
  });

  it('adds medication professional guidance when AI gives only vague medication copy', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening reset',
                    body: [
                      'Medication context tonight.',
                      'Use sunscreen tomorrow morning.',
                    ],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [
                    {
                      severity: 'info',
                      message:
                        'Extra sun protection is useful with this medication.',
                      ingredientSlugs: [],
                      sourceIds: [
                        SuggestionEvidenceSourceId.AadSunscreenSelection,
                      ],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      safety_context: { medications: ['oral acne medication'] },
      under_dermatologist_care: 'yes',
    } as unknown as SkinProfile;
    inputs.contextSummary.safetyConstraints = [
      'pregnancy_or_medication_active_caution',
    ];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.explanation.body).toEqual(
      expect.arrayContaining([
        expect.stringContaining('your dermatologist clears them'),
      ]),
    );
    expect(result.explanation.body.join(' ')).not.toContain('sunscreen');
    expect(result.safetyFlags).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.AadSunscreenSelection,
          ]),
        }),
      ]),
    );
  });

  it('adds pigment evidence when selected SPF supports a pigment goal', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning pigment support',
                    body: ['SPF stays central for dark marks.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.skinProfile = {
      primary_goal: 'fade post-acne hyperpigmentation',
      current_concerns: ['dark marks'],
    } as unknown as SkinProfile;
    inputs.contextSummary.skinProfile.primaryGoal =
      'fade post-acne hyperpigmentation';
    inputs.contextSummary.skinProfile.activeConcerns = ['dark marks'];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.safetyFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
          ]),
        }),
      ]),
    );
  });

  it('adds deterministic sunscreen gap when AI omits it and no SPF is owned', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning pigment support',
                    body: ['Use owned products gently this morning.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.shelfActiveProducts = inputs.shelfActiveProducts.filter(
      (productValue) => productValue.id !== 'spf-1',
    );
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.filter(
        (score) => score.productId !== 'spf-1',
      );
    inputs.skinProfile = {
      primary_goal: 'fade post-breakout dark marks',
      current_concerns: ['dark marks'],
    } as unknown as SkinProfile;

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.gapRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory: expect.stringContaining('sunscreen'),
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.AadSunscreenSelection,
          ]),
        }),
      ]),
    );
  });

  it('normalizes equivalent AI sunscreen gap wording when no SPF is owned', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Morning barrier care',
                    body: [
                      'Barrier cream fits the dry-skin note and morning slot.',
                      'SPF is missing, so I flagged a gap for mark care.',
                    ],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(
                      0,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [
                    {
                      ingredientOrCategory: 'sun-protection',
                      reason: 'Missing morning SPF for dark marks.',
                      budgetTier: null,
                      goalAlignment:
                        'Supports post-breakout marks and daily UV protection.',
                      sourceIds: [
                        SuggestionEvidenceSourceId.AadSunscreenSelection,
                        SuggestionEvidenceSourceId.MayoDrySkinCare,
                      ],
                    },
                  ],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.shelfActiveProducts = inputs.shelfActiveProducts.filter(
      (productValue) => productValue.id !== 'spf-1',
    );
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.filter(
        (score) => score.productId !== 'spf-1',
      );
    inputs.skinProfile = {
      primary_goal: 'reduce post-breakout marks',
      current_concerns: ['dark marks', 'dryness'],
    } as unknown as SkinProfile;

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.gapRecommendations).toHaveLength(1);
    expect(result.gapRecommendations[0]).toEqual(
      expect.objectContaining({
        ingredientOrCategory: expect.stringMatching(/sunscreen/i),
        sourceIds: expect.arrayContaining([
          SuggestionEvidenceSourceId.AadSunscreenSelection,
        ]),
      }),
    );
  });

  it('trims overlong 10-minute scheduled AI routines without falling back', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Gentle texture evening',
                    body: [
                      'Kept tonight gentle and barrier-focused.',
                      'The routine supports dryness, pores, and texture.',
                    ],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'toner-1', ProductCategory.Toner),
                    aiProductStep(1, 'essence-1', ProductCategory.Essence),
                    aiProductStep(
                      2,
                      'hydrating-serum-1',
                      ProductCategory.Serum,
                    ),
                    aiProductStep(3, 'niacinamide-1', ProductCategory.Serum),
                    aiProductStep(4, 'azelaic-1', ProductCategory.Serum),
                    aiProductStep(
                      5,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      primary_goal: 'smooth rough texture gradually',
      current_concerns: ['texture', 'large pores', 'dryness'],
      routine_preferences: {
        pace: 'steady',
        pm_minutes: 10,
      },
    } as unknown as SkinProfile;
    inputs.contextSummary.skinProfile.primaryGoal =
      'smooth rough texture gradually';
    inputs.contextSummary.skinProfile.activeConcerns = [
      'texture',
      'large pores',
      'dryness',
    ];
    inputs.contextSummary.safetyConstraints = ['space_strong_actives'];
    inputs.shelfActiveProducts.push(
      product('toner-1', 'Soothing Toner', ProductCategory.Toner),
      product('essence-1', 'Barrier Essence', ProductCategory.Essence),
      product('hydrating-serum-1', 'Hydration Serum', ProductCategory.Serum),
      product('niacinamide-1', 'Niacinamide Serum', ProductCategory.Serum),
      product('azelaic-1', 'Azelaic Support Serum', ProductCategory.Serum),
    );
    inputs.contextSummary.productScores.push(
      productScore('toner-1', ProductCategory.Toner, 82, ['soothing']),
      productScore('essence-1', ProductCategory.Essence, 91, [
        'barrier',
        'hydrating',
      ]),
      productScore('hydrating-serum-1', ProductCategory.Serum, 86, [
        'hydrating',
      ]),
      productScore('niacinamide-1', ProductCategory.Serum, 90, ['niacinamide']),
      productScore('azelaic-1', ProductCategory.Serum, 87, [
        'azelaic',
        'pigment-support',
      ]),
    );

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps).toHaveLength(4);
    expect(result.steps.map((step) => step.inventoryProductId)).toContain(
      'moisturizer-1',
    );
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual(
      expect.arrayContaining(['essence-1', 'niacinamide-1']),
    );
  });

  it('adds owned moisturizer when on-demand post-workout AI output is too thin', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Quick post-gym reset',
                    body: ['Keep it simple after sweating.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'spf-1', ProductCategory.SunProtection),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Noon);
    inputs.requestSource = SuggestionRequestSource.OnDemand;
    inputs.requestContext = {
      intent: 'post_workout',
      intensity: 'minimal',
      note: 'Sweaty after gym, need something quick.',
      activityAt: '2026-05-18T12:40:00.000Z',
      requestedAt: '2026-05-18T13:10:00.000Z',
    };

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('does not add a deterministic barrier gap when selected moisturizer covers it', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Hydration first',
                    body: ['Dry air calls for barrier support.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      1,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.contextSummary.environment = {
      ...highUvEnvironment(),
      uvRisk: EnvironmentUvRisk.Moderate,
      humidityBand: EnvironmentHumidityBand.VeryDry,
      temperatureBand: EnvironmentTemperatureBand.Cold,
    };

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inventoryProductId: 'moisturizer-1',
          stepLabel: ProductCategory.Moisturizer,
        }),
      ]),
    );
    expect(result.gapRecommendations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory: expect.stringMatching(/barrier|moisturizer/i),
        }),
      ]),
    );
  });

  it('keeps missing sunscreen as a trusted-source gap, never an invented step', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.shelfActiveProducts = inputs.shelfActiveProducts.filter(
      (product) => product.id !== 'spf-1',
    );
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.filter(
        (score) => score.productId !== 'spf-1',
      );

    const result = await generator.generate(inputs);

    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepLabel: ProductCategory.SunProtection,
        }),
      ]),
    );
    expect(result.gapRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory: expect.stringContaining('sunscreen'),
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.AadSunscreenSelection,
          ]),
        }),
      ]),
    );
  });

  it('does not treat compatible same-category products as mutually exclusive in scheduled fallback', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.shelfActiveProducts.push(
      product(
        'hydrating-serum-1',
        'Hydrating Support Serum',
        ProductCategory.Serum,
        {
          identity: productIdentity({
            name: 'Hydrating Support Serum',
            category: ProductCategory.Serum,
            description: 'Water-light serum for hydration support.',
            inciIngredients: ['Glycerin', 'Sodium Hyaluronate'],
            benefits: ['hydration support'],
            suitedFor: ['dehydrated skin'],
          }),
        },
      ),
    );
    inputs.contextSummary.productScores = [
      productScore('serum-1', ProductCategory.Serum, 95, ['niacinamide']),
      productScore('hydrating-serum-1', ProductCategory.Serum, 93, [
        'humectant',
      ]),
      productScore('spf-1', ProductCategory.SunProtection, 92, ['spf']),
      productScore('cleanser-1', ProductCategory.Cleanser, 88, []),
      productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
        'ceramide',
      ]),
    ];

    const result = await generator.generate(inputs);
    const productIds = result.steps.map((step) => step.inventoryProductId);

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(productIds).toEqual(expect.arrayContaining(['serum-1']));
    expect(productIds).toEqual(expect.arrayContaining(['hydrating-serum-1']));
  });

  it('does not treat compatible same-category products as mutually exclusive in quick suggestion fallback', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.requestSource = SuggestionRequestSource.OnDemand;
    inputs.requestContext = {
      intent: 'quick_refresh',
      intensity: 'standard',
      note: 'Skin feels comfortable but dehydrated before going out.',
      activityAt: null,
      requestedAt: '2026-04-29T08:30:00.000Z',
    };
    inputs.contextSummary.requestSource = SuggestionRequestSource.OnDemand;
    inputs.contextSummary.onDemand = inputs.requestContext;
    inputs.shelfActiveProducts.push(
      product(
        'hydrating-serum-1',
        'Hydrating Support Serum',
        ProductCategory.Serum,
        {
          identity: productIdentity({
            name: 'Hydrating Support Serum',
            category: ProductCategory.Serum,
            description: 'Water-light serum for hydration support.',
            inciIngredients: ['Glycerin', 'Sodium Hyaluronate'],
            benefits: ['hydration support'],
            suitedFor: ['dehydrated skin'],
          }),
        },
      ),
    );
    inputs.contextSummary.productScores = [
      productScore('serum-1', ProductCategory.Serum, 95, ['niacinamide']),
      productScore('hydrating-serum-1', ProductCategory.Serum, 93, [
        'humectant',
      ]),
      productScore('spf-1', ProductCategory.SunProtection, 92, ['spf']),
      productScore('cleanser-1', ProductCategory.Cleanser, 88, []),
      productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
        'ceramide',
      ]),
    ];

    const result = await generator.generate(inputs);
    const productIds = result.steps.map((step) => step.inventoryProductId);

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.explanation.headline).toBe('Quick shelf suggestion');
    expect(productIds).toEqual(expect.arrayContaining(['serum-1']));
    expect(productIds).toEqual(expect.arrayContaining(['hydrating-serum-1']));
  });

  it('does not layer products when ingredient analysis reports a conflict', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.shelfActiveProducts.push(
      product('vitamin-c-1', 'L-Ascorbic Acid Serum', ProductCategory.Serum, {
        identity: productIdentity({
          name: 'L-Ascorbic Acid Serum',
          category: ProductCategory.Serum,
          description: 'Pure vitamin C serum.',
          inciIngredients: ['L-Ascorbic Acid'],
          benefits: ['brightening support'],
          suitedFor: ['uneven tone'],
        }),
        guidance: {
          applicationMethod: ApplicationMethod.Fingertips,
          quantity: Quantity.PeaSize,
          steps: [],
          cautions: [],
          waitMinutes: null,
        },
      }),
    );
    const ingredientConflict = ingredientConflictSummary(
      'RETINOID_AHA',
      'serum-1',
      'vitamin-c-1',
    );
    inputs.contextSummary.productScores = [
      {
        ...productScore('serum-1', ProductCategory.Serum, 95, ['niacinamide']),
        ingredientConflicts: [ingredientConflict],
      },
      {
        ...productScore('vitamin-c-1', ProductCategory.Serum, 94, [
          'vitamin_c',
        ]),
        ingredientConflicts: [ingredientConflict],
      },
      productScore('spf-1', ProductCategory.SunProtection, 92, ['spf']),
      productScore('cleanser-1', ProductCategory.Cleanser, 88, []),
      productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
        'ceramide',
      ]),
    ];

    const result = await generator.generate(inputs);
    const productIds = result.steps
      .map((step) => step.inventoryProductId)
      .filter((productId): productId is string => Boolean(productId));

    expect(productIds).not.toEqual(
      expect.arrayContaining(['serum-1', 'vitamin-c-1']),
    );
  });

  it('repairs OpenAI output that stacks two non-locked cleansers in one routine', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening reset',
                    body: ['Use one cleanse, then moisturize.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'sa-cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.shelfActiveProducts.push(
      product(
        'sa-cleanser-1',
        'SA Smoothing Cleanser',
        ProductCategory.Cleanser,
      ),
    );
    inputs.contextSummary.productScores = [
      productScore('sa-cleanser-1', ProductCategory.Cleanser, 95, ['bha']),
      productScore('cleanser-1', ProductCategory.Cleanser, 88, []),
      productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
        'ceramide',
      ]),
    ];

    const result = await generator.generate(inputs);
    const cleanserIds = result.steps
      .filter((step) => step.stepLabel === ProductCategory.Cleanser)
      .map((step) => step.inventoryProductId);

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(cleanserIds).toEqual(['sa-cleanser-1']);
    expect(result.steps.map((step) => step.inventoryProductId)).toContain(
      'moisturizer-1',
    );
  });

  it.each([
    {
      category: ProductCategory.SunProtection,
      daypart: SuggestionDaypart.Morning,
      existingProductId: 'spf-1',
      duplicateProductId: 'mineral-spf-1',
      duplicateProductName: 'Mineral SPF 50',
      supportProductId: 'moisturizer-1',
      supportCategory: ProductCategory.Moisturizer,
    },
    {
      category: ProductCategory.Mask,
      daypart: SuggestionDaypart.Evening,
      existingProductId: 'clay-mask-1',
      duplicateProductId: 'calm-mask-1',
      duplicateProductName: 'Calm Gel Mask',
      supportProductId: 'moisturizer-1',
      supportCategory: ProductCategory.Moisturizer,
    },
    {
      category: ProductCategory.Exfoliant,
      daypart: SuggestionDaypart.Evening,
      existingProductId: 'pha-exfoliant-1',
      duplicateProductId: 'enzyme-exfoliant-1',
      duplicateProductName: 'Enzyme Polish',
      supportProductId: 'moisturizer-1',
      supportCategory: ProductCategory.Moisturizer,
    },
  ])(
    'repairs OpenAI output that stacks two non-locked $category products in one routine',
    async ({
      category,
      daypart,
      existingProductId,
      duplicateProductId,
      duplicateProductName,
      supportProductId,
      supportCategory,
    }) => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    simplifiedForReaction: false,
                    explanation: {
                      headline: 'Slot plan',
                      body: ['Use the best-fitting routine option.'],
                      perStepReasons: [],
                      skipped: [],
                      inputs: [],
                    },
                    steps: [
                      aiProductStep(0, existingProductId, category),
                      aiProductStep(1, duplicateProductId, category),
                      aiProductStep(2, supportProductId, supportCategory),
                    ],
                    gapRecommendations: [],
                    safetyFlags: [],
                  }),
                },
              ],
            },
          ],
        }),
      });
      global.fetch = fetchMock;
      const generator = new SuggestionAiGenerator({
        get: jest.fn((key: string) => {
          if (key === 'OPENAI_API_KEY') return 'sk-test';
          if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
          return null;
        }),
      } as unknown as ConfigService);
      const inputs = inputsWithScoredShelfProducts(daypart);
      inputs.shelfActiveProducts.push(
        product(existingProductId, existingProductId, category),
        product(duplicateProductId, duplicateProductName, category),
      );
      inputs.contextSummary.productScores = [
        productScore(duplicateProductId, category, 96, []),
        productScore(existingProductId, category, 84, []),
        productScore(supportProductId, supportCategory, 82, ['ceramide']),
      ];

      const result = await generator.generate(inputs);
      const categoryProductIds = result.steps
        .filter((step) => step.stepLabel === category)
        .map((step) => step.inventoryProductId);

      expect(result.metadata.provider).toBe('openai');
      expect(result.metadata.fallbackReason).toBeNull();
      expect(categoryProductIds).toEqual([duplicateProductId]);
      expect(result.steps.map((step) => step.inventoryProductId)).toContain(
        supportProductId,
      );
    },
  );

  it('uses product-specific copy when repairing a conflicting AI product selection', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Evening tone support',
                    body: ['Use a focused evening routine for marks.'],
                    perStepReasons: [],
                    skipped: [],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'cleanser-1', ProductCategory.Cleanser),
                    aiProductStep(1, 'vitamin-c-1', ProductCategory.Serum),
                    aiProductStep(
                      2,
                      'moisturizer-1',
                      ProductCategory.Moisturizer,
                    ),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.skinProfile = {
      primary_goal: 'fade post-acne dark marks',
      current_concerns: ['dark marks', 'uneven tone'],
    } as SkinProfile;
    inputs.contextSummary.skinProfile.primaryGoal = 'fade post-acne dark marks';
    inputs.contextSummary.skinProfile.activeConcerns = [
      'dark marks',
      'uneven tone',
    ];
    inputs.shelfActiveProducts.push(
      product('vitamin-c-1', 'Vitamin C Serum', ProductCategory.Serum),
      product('niacinamide-1', 'Niacinamide Serum', ProductCategory.Serum),
    );
    const ingredientConflict = ingredientConflictSummary(
      'TEST_LAYERING_CONFLICT',
      'vitamin-c-1',
      'niacinamide-1',
    );
    inputs.contextSummary.productScores = [
      productScore('cleanser-1', ProductCategory.Cleanser, 88, []),
      {
        ...productScore('vitamin-c-1', ProductCategory.Serum, 84, [
          'vitamin_c',
        ]),
        ingredientConflicts: [ingredientConflict],
      },
      {
        ...productScore('niacinamide-1', ProductCategory.Serum, 96, [
          'niacinamide',
        ]),
        benefits: ['dark marks', 'uneven tone'],
        ingredientConflicts: [ingredientConflict],
      },
      productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
        'ceramide',
      ]),
    ];

    const result = await generator.generate(inputs);
    const repairedStep = result.steps.find(
      (step) => step.inventoryProductId === 'niacinamide-1',
    );

    expect(result.metadata.provider).toBe('openai');
    expect(result.metadata.fallbackReason).toBeNull();
    expect(result.steps.map((step) => step.inventoryProductId)).toContain(
      'niacinamide-1',
    );
    expect(result.steps.map((step) => step.inventoryProductId)).not.toContain(
      'vitamin-c-1',
    );
    expect(repairedStep?.explanation).toBe(
      'Supports dark marks and uneven tone today.',
    );
    expect(repairedStep?.explanation).not.toMatch(
      /current scoring|conflicting products|layered together|current context/i,
    );
    expect(result.explanation.perStepReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'Supports dark marks and uneven tone today.',
        }),
      ]),
    );
  });

  it('removes skipped-product aliases that do not exactly match owned shelf products', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  simplifiedForReaction: false,
                  explanation: {
                    headline: 'Use one breakout step',
                    body: ['Pick one active tonight.'],
                    perStepReasons: [],
                    skipped: [
                      {
                        name: 'Ava Lab 1% Retinol care',
                        reason: 'ingredient/layering caution',
                      },
                    ],
                    inputs: [],
                  },
                  steps: [
                    aiProductStep(0, 'benzoyl-1', ProductCategory.Treatment),
                  ],
                  gapRecommendations: [],
                  safetyFlags: [],
                }),
              },
            ],
          },
        ],
      }),
    });
    global.fetch = fetchMock;
    const generator = new SuggestionAiGenerator({
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.shelfActiveProducts.push(
      product('retinol-1', '1% Retinol Treatment', ProductCategory.Treatment),
      product(
        'benzoyl-1',
        'Benzoyl Peroxide Treatment',
        ProductCategory.Treatment,
      ),
    );
    inputs.contextSummary.productScores = [
      productScore('retinol-1', ProductCategory.Treatment, 92, ['retinoid']),
      productScore('benzoyl-1', ProductCategory.Treatment, 94, [
        'benzoyl_peroxide',
      ]),
    ];

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('openai');
    expect(result.explanation.skipped).toEqual([]);
  });

  it('does not stack two cleansers in deterministic fallback', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Evening);
    inputs.shelfActiveProducts.push(
      product(
        'sa-cleanser-1',
        'SA Smoothing Cleanser',
        ProductCategory.Cleanser,
      ),
    );
    inputs.contextSummary.productScores = [
      productScore('sa-cleanser-1', ProductCategory.Cleanser, 95, ['bha']),
      productScore('cleanser-1', ProductCategory.Cleanser, 88, []),
      productScore('serum-1', ProductCategory.Serum, 84, ['niacinamide']),
      productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
        'ceramide',
      ]),
    ];

    const result = await generator.generate(inputs);
    const cleanserIds = result.steps
      .filter((step) => step.stepLabel === ProductCategory.Cleanser)
      .map((step) => step.inventoryProductId);

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(cleanserIds).toEqual(['sa-cleanser-1']);
  });

  it('localizes deterministic fallback copy for Spanish suggestions', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    inputs.language = 'es';
    inputs.shelfActiveProducts = inputs.shelfActiveProducts.filter(
      (product) => product.id !== 'spf-1',
    );
    inputs.contextSummary.productScores =
      inputs.contextSummary.productScores.filter(
        (score) => score.productId !== 'spf-1',
      );

    const result = await generator.generate(inputs);

    expect(result.explanation.headline).toBe('Usando tu estante hoy');
    expect(result.explanation.inputs[0]).toEqual(
      expect.objectContaining({
        label: 'Evidencia',
        detail: expect.stringContaining('fuentes fiables'),
      }),
    );
    expect(result.gapRecommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory: 'Protector solar de amplio espectro SPF 30+',
          reason:
            'Las rutinas diurnas necesitan una opcion de protector solar.',
        }),
      ]),
    );
    expect(result.safetyFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('protector solar'),
        }),
      ]),
    );
  });
});

function inputsWithScoredShelfProducts(
  daypart: SuggestionDaypart,
): SuggestionGenerationInputs {
  const products = [
    product('cleanser-1', 'Soft Cleanser', ProductCategory.Cleanser),
    product('serum-1', 'Niacinamide Serum', ProductCategory.Serum),
    product('moisturizer-1', 'Barrier Cream', ProductCategory.Moisturizer),
    product('spf-1', 'Daily SPF 50', ProductCategory.SunProtection),
  ];
  return {
    slotId: 'slot-1',
    requestSource: SuggestionRequestSource.Scheduled,
    requestContext: null,
    targetDate: '2026-04-29',
    targetTime: daypart === SuggestionDaypart.Evening ? '20:00' : '08:00',
    daypart,
    skinProfile: null,
    shelfActiveProducts: products,
    shelfFinishedProductIds: [],
    routineSteps: [],
    recentJournalEntries: [],
    recentApplications: [],
    aiPersonalizationAllowed: true,
    aiPersonalizationBlockedReason: null,
    environmentSnapshotId: null,
    contextSummary: {
      cacheKey: 'ctx-products',
      builtAt: '2026-04-29T06:00:00.000Z',
      targetDate: '2026-04-29',
      targetTime: daypart === SuggestionDaypart.Evening ? '20:00' : '08:00',
      daypart,
      requestSource: SuggestionRequestSource.Scheduled,
      onDemand: null,
      environment: null,
      skinProfile: {
        primaryGoal: 'barrier support',
        skinType: null,
        sensitivityLevel: null,
        activeConcerns: [],
        pregnancyStatus: null,
      },
      reaction: {
        hasSignal: false,
        severity: null,
        confidence: null,
        indicators: [],
        affectedZones: [],
        concernKeys: [],
        daysSinceLatestSignal: null,
        barrierCompromised: false,
        photoInputImages: 0,
        multiAnglePhotoEntries: 0,
      },
      routineBreak: {
        recentlyResumed: false,
        lastPausedFrom: null,
        lastPausedUntil: null,
      },
      productScores: [
        productScore('cleanser-1', ProductCategory.Cleanser, 88, []),
        productScore('serum-1', ProductCategory.Serum, 84, ['niacinamide']),
        productScore('moisturizer-1', ProductCategory.Moisturizer, 82, [
          'ceramide',
        ]),
        productScore('spf-1', ProductCategory.SunProtection, 92, ['spf']),
      ],
      applicationPatterns: {
        days: 0,
        daysSinceLastApplication: null,
        conservativeRestart: false,
        skippedByCategory: {},
        substitutedByCategory: {},
        addedOffShelfCount: 0,
        editedLogCount: 0,
        adherenceByCategory: {},
      },
      safetyConstraints: ['daytime_spf_available'],
      governance: {
        safetyPolicyVersion: 'test-policy',
        safetyPolicyReviewedAt: '2026-05-04',
        aiPersonalizationAllowed: true,
        aiPersonalizationBlockedReason: null,
      },
      evidenceSources: getSuggestionEvidenceSources([
        SuggestionEvidenceSourceId.AadSunscreenSelection,
        SuggestionEvidenceSourceId.MayoDrySkinCare,
      ]),
      skippedCandidates: [],
    },
  };
}

function product(
  id: string,
  name: string,
  category: ProductCategory,
  overrides: Partial<InventoryProduct> = {},
): InventoryProduct {
  return {
    id,
    user_id: 'user-1',
    brand: 'Ava Lab',
    name,
    category,
    status: ShelfStatus.Active,
    introduction_status:
      overrides.introduction_status ?? ProductIntroductionStatus.Tolerated,
    introduction_started_at: overrides.introduction_started_at ?? null,
    introduction_status_updated_at:
      overrides.introduction_status_updated_at ?? null,
    guidance: {
      applicationMethod: 'fingertips',
      quantity: 'pea-size',
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    ...overrides,
  } as unknown as InventoryProduct;
}

function openAiTextResponse(
  value: unknown,
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  },
) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify(value),
            },
          ],
        },
      ],
      usage,
    }),
  };
}

function openAiErrorResponse(status: number, retryAfter: string | null) {
  return {
    ok: false,
    status,
    headers: {
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'retry-after' ? retryAfter : null,
      ),
    },
  };
}

function agentPlan() {
  return {
    dataAudit: [
      {
        source: 'active_shelf_products',
        status: 'available',
        notes: 'Owned product data is available.',
      },
    ],
    decisionChecklist: ['Respect ownership, timing, SPF, and conflicts.'],
    candidateProductIds: ['cleanser-1', 'moisturizer-1', 'spf-1'],
    blockedProductIds: [],
    pairingRisks: [],
    reviewFocus: ['required daytime SPF', 'exact product IDs'],
  };
}

function agentPassingReview() {
  return {
    passed: true,
    blockingIssues: [],
    nonBlockingIssues: [],
    repairInstructions: [],
  };
}

function productScore(
  productId: string,
  category: ProductCategory,
  suitabilityScore: number,
  activeTags: string[],
) {
  return {
    productId,
    brand: 'Ava Lab',
    name: productId,
    category,
    preferredTimeOfDay: PreferredTimeOfDay.Either,
    activeTags,
    suitabilityScore,
    suitabilityReasons: ['matches this slot'],
    cautionReasons: [],
    waitMinutes: null,
    inciQuality: 'available' as const,
    dataQuality: 'verified' as const,
    dataQualityWarnings: [],
    evidenceSourceIds:
      category === ProductCategory.SunProtection
        ? [SuggestionEvidenceSourceId.AadSunscreenSelection]
        : [SuggestionEvidenceSourceId.MayoDrySkinCare],
  };
}

function ingredientConflictSummary(
  code: string,
  firstProductId: string,
  secondProductId: string,
) {
  const productIds = [firstProductId, secondProductId].sort() as [
    string,
    string,
  ];
  return {
    id: `${code}:${productIds.join(':')}`,
    code,
    severity: AnalysisSeverity.High,
    productIds,
    ingredientNames: ['Retinol', 'Glycolic Acid'] as [string, string],
    description:
      'Retinoids and alpha hydroxy acids in the same routine can raise irritation and barrier stress.',
    mitigation: 'Use them on alternate nights or separate them by routine.',
  };
}

function productIdentity(input: {
  name: string;
  category: ProductCategory;
  description: string;
  inciIngredients: string[];
  benefits: string[];
  suitedFor: string[];
}): InventoryProduct['identity'] {
  return {
    brand: 'Ava Lab',
    name: input.name,
    category: input.category,
    barcode: null,
    imageUrls: [],
    sizeMl: null,
    description: input.description,
    benefits: input.benefits,
    suitedFor: input.suitedFor,
    inciIngredients: input.inciIngredients,
    inciLastConfirmedAt: '2026-05-01T00:00:00.000Z',
  };
}

function routineStep(
  id: string,
  stepOrder: number,
  productValue: InventoryProduct,
): RoutineStep {
  return {
    id,
    slot_id: 'slot-1',
    step_order: stepOrder,
    inventory_product_id: productValue.id,
    step_label: productValue.category,
    custom_label: null,
    notes: null,
    optional: false,
    is_specialist_locked: false,
    product: productValue,
  } as RoutineStep;
}

function highUvEnvironment(): EnvironmentContextSummary {
  return {
    status: EnvironmentStatus.Available,
    provider: EnvironmentProviderName.OpenMeteo,
    generatedAt: '2026-04-29T06:00:00.000Z',
    locationPersonalized: true,
    season: EnvironmentSeason.Spring,
    temperatureCelsius: 18,
    temperatureBand: EnvironmentTemperatureBand.Mild,
    humidity: 48,
    humidityBand: EnvironmentHumidityBand.Balanced,
    uvIndex: 9,
    uvRisk: EnvironmentUvRisk.VeryHigh,
    airQualityIndex: 20,
    airQualityRisk: EnvironmentAirQualityRisk.Good,
    pm25: null,
    pm10: null,
    pollenRisk: null,
    conditionLabel: 'Clear',
    waterHardness: EnvironmentWaterHardness.Unknown,
    waterSensitivity: EnvironmentWaterSensitivity.None,
    climateSensitivities: [],
    transitionSignals: [],
    confidence: EnvironmentConfidence.Provider,
    stale: false,
    sourceIds: [SuggestionEvidenceSourceId.OpenMeteoWeather],
  };
}

function aiProductStep(
  stepOrder: number,
  inventoryProductId: string,
  stepLabel: ProductCategory,
) {
  return {
    stepOrder,
    routineStepId: null,
    inventoryProductId,
    productBrand: 'Ava Lab',
    productName: inventoryProductId,
    stepLabel,
    customLabel: null,
    applicationMethod: null,
    quantity: null,
    waitAfterMinutes: null,
    explanation: 'Use this product.',
    provenance: SuggestionStepProvenance.AiAdded,
    chips: [],
    safetyWarnings: [],
  };
}

function addStableSameDaypartRepeatMemory(
  inputs: SuggestionGenerationInputs,
): void {
  inputs.contextSummary.routineMemory = {
    recordsConsidered: 60,
    previousSuggestionCount: 30,
    sameDaypartSuggestionCount: 12,
    recentSameDaypartFingerprints: [
      {
        targetDate: '2026-04-28',
        targetTime: '08:00',
        productIds: ['cleanser-1', 'moisturizer-1', 'spf-1'],
        productNames: ['Soft Cleanser', 'Barrier Cream', 'Daily SPF 50'],
        fingerprint: 'stable-morning-basics',
      },
    ],
    recentSameDateSuggestions: [],
    recentlySuggestedProductIds: ['cleanser-1', 'moisturizer-1', 'spf-1'],
    exactRepeatCountByFingerprint: { 'stable-morning-basics': 8 },
    skippedProducts: {},
    substitutedProducts: {},
    adheredProducts: {
      'cleanser-1': 30,
      'moisturizer-1': 30,
      'spf-1': 30,
    },
    editedLogCount: 0,
    offShelfUseCount: 0,
  };
  inputs.contextSummary.appliedProductHistory = {
    windowStartDate: '2026-03-31',
    windowEndDate: '2026-04-29',
    recordsConsidered: 30,
    products: [
      {
        productId: 'cleanser-1',
        brand: 'Ava Lab',
        name: 'Soft Cleanser',
        category: ProductCategory.Cleanser,
        stepLabel: ProductCategory.Cleanser,
        sourceTypes: ['recommended'],
        dayparts: [SuggestionDaypart.Morning],
        statuses: ['applied'],
        useCount: 30,
        lastAppliedDate: '2026-04-28',
        lastAppliedAt: '2026-04-28T08:00:00.000Z',
        isOffShelf: false,
        isSubstitution: false,
      },
      {
        productId: 'moisturizer-1',
        brand: 'Ava Lab',
        name: 'Barrier Cream',
        category: ProductCategory.Moisturizer,
        stepLabel: ProductCategory.Moisturizer,
        sourceTypes: ['recommended'],
        dayparts: [SuggestionDaypart.Morning],
        statuses: ['applied'],
        useCount: 30,
        lastAppliedDate: '2026-04-28',
        lastAppliedAt: '2026-04-28T08:02:00.000Z',
        isOffShelf: false,
        isSubstitution: false,
      },
      {
        productId: 'spf-1',
        brand: 'Ava Lab',
        name: 'Daily SPF 50',
        category: ProductCategory.SunProtection,
        stepLabel: ProductCategory.SunProtection,
        sourceTypes: ['recommended'],
        dayparts: [SuggestionDaypart.Morning],
        statuses: ['applied'],
        useCount: 30,
        lastAppliedDate: '2026-04-28',
        lastAppliedAt: '2026-04-28T08:04:00.000Z',
        isOffShelf: false,
        isSubstitution: false,
      },
    ],
  };
}
