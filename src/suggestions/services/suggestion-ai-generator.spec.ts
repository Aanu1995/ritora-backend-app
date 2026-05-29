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
import {
  PreferredTimeOfDay,
  ProductCategory,
  ShelfStatus,
} from '../../shelf/shelf.types';
import {
  SuggestionDaypart,
  SuggestionEvidenceSourceId,
  SuggestionMode,
  SuggestionRequestSource,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import { SuggestionAiGenerator } from './suggestion-ai-generator';
import { SuggestionGenerationInputs } from './suggestion-ai-generator';
import { getSuggestionEvidenceSources } from './suggestion-evidence-sources';

describe('SuggestionAiGenerator', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('calls OpenAI with low-temperature structured output for repeatable suggestions', async () => {
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

    const body = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(body).toEqual(
      expect.objectContaining({
        model: 'gpt-4.1-mini',
        store: false,
        reasoning: { effort: OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT },
        temperature: 0,
      }),
    );
  });

  it('uses medium reasoning for on-demand quick suggestions', async () => {
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

  it('falls back when OpenAI returns a pregnancy-caution retinoid application step', async () => {
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

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('unsafe_pregnancy_active');
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

  it('falls back when a step is actually copy for later use', async () => {
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

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe(
      'skipped_product_returned_as_step',
    );
  });

  it('falls back when daytime high-UV output selects a strong active', async () => {
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

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('unsafe_daytime_strong_active');
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'retinoid-1' }),
      ]),
    );
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

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe(
      'preferred_time_of_day_mismatch',
    );
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'serum-1' }),
      ]),
    );
  });

  it('falls back when OpenAI selects a morning-preferred product at night', async () => {
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

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe(
      'preferred_time_of_day_mismatch',
    );
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

  it('falls back when OpenAI adds a novelty product without user-history indication', async () => {
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

    const result = await generator.generate(inputs);

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('unjustified_history_novelty');
    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('allows a non-repeated product when applied history shows user use', async () => {
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
    inputs.contextSummary.appliedProductHistory?.products.push({
      productId: 'serum-1',
      brand: 'Ava Lab',
      name: 'Niacinamide Serum',
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
      'serum-1',
      'moisturizer-1',
      'spf-1',
    ]);
  });

  it('keeps deterministic fallback to history-backed repeat products only', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);
    const inputs = inputsWithScoredShelfProducts(SuggestionDaypart.Morning);
    addStableSameDaypartRepeatMemory(inputs);

    const result = await generator.generate(inputs);

    expect(result.steps.map((step) => step.inventoryProductId)).toEqual([
      'cleanser-1',
      'moisturizer-1',
      'spf-1',
    ]);
    expect(result.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryProductId: 'serum-1' }),
      ]),
    );
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

  it('adds owned barrier support in mixed-mode fallback without changing manual product choices', async () => {
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

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('missing_barrier_moisturizer');
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
    expect(result.explanation.body.length).toBeGreaterThan(0);
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

  it('falls back when explanation copy contradicts multiple application steps', async () => {
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

    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('contradictory_only_copy');
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
    expect(result.metadata.fallbackReason).toBe('no_usable_shelf_limited_data');
    expect(result.steps).toEqual([]);
    expect(result.explanation.headline).toBe('No shelf steps yet');
  });

  it('uses deterministic copy for empty shelves instead of asking OpenAI for gap wording', async () => {
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metadata.provider).toBe('deterministic_baseline');
    expect(result.metadata.fallbackReason).toBe('no_usable_shelf_limited_data');
    expect(result.steps).toEqual([]);
    expect(result.explanation.body).toEqual(
      expect.arrayContaining([
        'No active shelf products are available to apply right now.',
        'Sunscreen is missing from your shelf, so it stays a gap instead of an invented step.',
      ]),
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
        expect.objectContaining({
          inventoryProductId: 'serum-1',
          stepLabel: ProductCategory.Serum,
          provenance: 'ai_added',
        }),
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
          reason: 'Daytime sun protection fits this slot.',
        }),
      ]),
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
): InventoryProduct {
  return {
    id,
    user_id: 'user-1',
    brand: 'Ava Lab',
    name,
    category,
    status: ShelfStatus.Active,
    guidance: {
      applicationMethod: 'fingertips',
      quantity: 'pea-size',
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
  } as unknown as InventoryProduct;
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
