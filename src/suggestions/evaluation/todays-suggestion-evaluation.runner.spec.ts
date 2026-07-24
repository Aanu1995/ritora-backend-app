import { ProductCategory } from '../../shelf/shelf.types';
import {
  SUGGESTION_PROMPT_VERSION,
  SuggestionEvidenceSourceId,
  SuggestionMode,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import type {
  SuggestionGenerationOutput,
  SuggestionGenerationStepOutput,
} from '../services/suggestion-ai-generator';
import {
  TODAYS_SUGGESTION_GOLDEN_CASES,
  TODAYS_SUGGESTION_LIVE_EVALUATION_CASES,
  TodaysSuggestionEvaluationCase,
} from './todays-suggestion-golden-cases';
import {
  evaluateTodaysSuggestionGoldenCases,
  OpenAiTodaysSuggestionEvaluationJudge,
  runTodaysSuggestionHardChecks,
  sanitizeEvaluationText,
  sanitizeForReport,
  TodaysSuggestionEvaluationJudge,
} from './todays-suggestion-evaluation.runner';

describe("Today's Suggestion evaluation hard checks", () => {
  it('keeps public-readiness golden cases for the highest-risk Today suggestion scenarios', () => {
    expect(TODAYS_SUGGESTION_GOLDEN_CASES.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'pregnancy_retinoid_caution',
        'medication_active_caution',
        'active_reaction_barrier_damage',
        'acne_pigment_priority_conflict',
        'sparse_history_partial_shelf',
        'repeated_morning_routine_history',
        'twelve_product_dark_spots_morning',
        'twelve_product_acne_evening',
        'low_need_maintenance_morning_not_empty',
      ]),
    );
  });

  it('keeps live evaluation focused on current problem-regression cases by default', () => {
    expect(TODAYS_SUGGESTION_LIVE_EVALUATION_CASES.length).toBeLessThan(
      TODAYS_SUGGESTION_GOLDEN_CASES.length,
    );
    expect(
      TODAYS_SUGGESTION_LIVE_EVALUATION_CASES.map((item) => item.id),
    ).toEqual(
      expect.arrayContaining([
        'aha_bha_retinoid_conflict',
        'twelve_product_acne_evening',
        'tolerated_retinoid_evening_sparse_history',
        'tolerated_vitamin_c_morning_not_crowded_out',
        'non_serum_categories_evening',
      ]),
    );
  });

  it('gives repeated-routine golden cases structured product and routine history', () => {
    const evaluationCase = goldenCase('repeated_morning_routine_history');

    expect(evaluationCase.inputs.contextSummary.routineMemory).toEqual(
      expect.objectContaining({
        sameDaypartSuggestionCount: 30,
        adheredProducts: expect.objectContaining({
          'cleanser-1': 30,
          'moisturizer-1': 30,
          'spf-1': 30,
        }),
        exactRepeatCountByFingerprint: expect.objectContaining({
          'cleanser-1|moisturizer-1|spf-1': 30,
        }),
      }),
    );
    expect(
      evaluationCase.inputs.contextSummary.appliedProductHistory?.products,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'spf-1',
          name: 'Daily SPF 50',
          useCount: 30,
        }),
      ]),
    );
  });

  it('passes a source-backed missing-SPF gap case', () => {
    const evaluationCase = goldenCase('dark_marks_no_spf_gap');
    const checks = runTodaysSuggestionHardChecks(
      evaluationCase,
      darkMarksOutput({ includeSpfGap: true }),
    );

    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });

  it('fails invented products', () => {
    const evaluationCase = goldenCase('dark_marks_no_spf_gap');
    const output = darkMarksOutput({ includeSpfGap: true });
    output.steps[0].inventoryProductId = 'invented-product';
    output.steps[0].productName = 'Imaginary Repair Drops';

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'no_invented_products',
    );
  });

  it.each([
    {
      label: ProductCategory.Cleanser,
      productId: 'cleanser-1',
      productName: 'Soft Cream Cleanser',
    },
    {
      label: ProductCategory.SunProtection,
      productId: 'spf-1',
      productName: 'Daily SPF 50',
    },
    {
      label: ProductCategory.Mask,
      productId: 'mask-fragrance-1',
      productName: 'Fragranced Glow Mask',
    },
    {
      label: ProductCategory.Exfoliant,
      productId: 'bha-1',
      productName: 'BHA 2% Liquid',
    },
  ])('fails non-locked duplicate $label products in one routine', (fixture) => {
    const evaluationCase = goldenCase('twelve_product_acne_evening');
    const output = baseOutput({
      steps: [
        step({
          order: 0,
          productId: fixture.productId,
          productName: fixture.productName,
          label: fixture.label,
        }),
        step({
          order: 1,
          productId: fixture.productId,
          productName: fixture.productName,
          label: fixture.label,
        }),
        step({
          order: 2,
          productId: 'moisturizer-1',
          productName: 'Barrier Cream',
          label: ProductCategory.Moisturizer,
        }),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'single_use_category_duplicates',
    );
  });

  it('fails explanation copy that says a selected step was skipped', () => {
    const evaluationCase = goldenCase('post_workout_on_demand');
    const output = baseOutput({
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
        step({
          order: 0,
          productId: 'cleanser-1',
          productName: 'Soft Cream Cleanser',
          label: ProductCategory.Cleanser,
        }),
        step({
          order: 1,
          productId: 'moisturizer-1',
          productName: 'Barrier Cream',
          label: ProductCategory.Moisturizer,
        }),
        step({
          order: 2,
          productId: 'spf-1',
          productName: 'Daily SPF 50',
          label: ProductCategory.SunProtection,
        }),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'selected_step_skip_copy',
    );
  });

  it('allows skipped alternatives that share the selected step category', () => {
    const evaluationCase = goldenCase(
      'ingredient_conflict_vitamin_c_niacinamide_morning',
    );
    const output = baseOutput({
      explanation: {
        headline: 'Morning brightening routine',
        body: ['Vitamin C fits the dark-mark goal this morning.'],
        perStepReasons: [],
        skipped: [
          {
            name: 'Plain Lab Niacinamide Serum',
            reason: 'ingredient/layering caution',
          },
        ],
        inputs: [],
      },
      steps: [
        step({
          order: 0,
          productId: 'vitamin-c-1',
          productName: 'Ascorbyl Glucoside Solution 12%',
          label: ProductCategory.Serum,
        }),
        step({
          order: 1,
          productId: 'moisturizer-1',
          productName: 'Barrier Cream',
          label: ProductCategory.Moisturizer,
        }),
        step({
          order: 2,
          productId: 'spf-1',
          productName: 'Daily SPF 50',
          label: ProductCategory.SunProtection,
        }),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).not.toContain(
      'selected_step_skip_copy',
    );
  });

  it('still fails skipped copy that names the selected product exactly', () => {
    const evaluationCase = goldenCase(
      'ingredient_conflict_vitamin_c_niacinamide_morning',
    );
    const output = baseOutput({
      explanation: {
        headline: 'Morning brightening routine',
        body: ['Vitamin C fits the dark-mark goal this morning.'],
        perStepReasons: [],
        skipped: [
          {
            name: 'The Ordinary Ascorbyl Glucoside Solution 12%',
            reason: 'ingredient/layering caution',
          },
        ],
        inputs: [],
      },
      steps: [
        step({
          order: 0,
          productId: 'vitamin-c-1',
          productName: 'Ascorbyl Glucoside Solution 12%',
          label: ProductCategory.Serum,
        }),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'selected_step_skip_copy',
    );
  });

  it('fails specialist-locked step mutation', () => {
    const evaluationCase = goldenCase('specialist_locked_step');
    const output = baseOutput({
      steps: [
        step({
          order: 0,
          routineStepId: 'locked-adapalene-step',
          productId: 'bha-1',
          productName: 'BHA 2% Liquid',
          label: ProductCategory.Exfoliant,
          provenance: SuggestionStepProvenance.AiAdded,
        }),
      ],
      safetyFlags: [
        safetyFlag('Keep specialist-directed steps unchanged.', [
          SuggestionEvidenceSourceId.AadRetinoidRetinol,
        ]),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'specialist_locked_steps',
    );
  });

  it('fails AI-added earlier-use steps after a specialist-locked treatment', () => {
    const evaluationCase = goldenCase('specialist_locked_step');
    const output = baseOutput({
      steps: [
        step({
          order: 0,
          routineStepId: 'locked-adapalene-step',
          productId: 'rx-adapalene-1',
          productName: 'Adapalene Gel',
          label: ProductCategory.Treatment,
          provenance: SuggestionStepProvenance.SpecialistLocked,
        }),
        step({
          order: 1,
          productId: 'cleanser-1',
          productName: 'Soft Cream Cleanser',
          label: ProductCategory.Cleanser,
        }),
        step({
          order: 2,
          productId: 'moisturizer-1',
          productName: 'Barrier Cream',
          label: ProductCategory.Moisturizer,
        }),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'specialist_locked_practical_order',
    );
  });

  it('fails unsafe strong active selections for reaction cases', () => {
    const evaluationCase = goldenCase('recent_barrier_reaction');
    const output = baseOutput({
      simplifiedForReaction: false,
      steps: [
        step({
          order: 0,
          productId: 'bha-1',
          productName: 'BHA 2% Liquid',
          label: ProductCategory.Exfoliant,
        }),
        step({
          order: 1,
          productId: 'retinoid-1',
          productName: 'Retinol Night Serum',
          label: ProductCategory.Treatment,
        }),
      ],
      safetyFlags: [],
    });

    expect(failedCheckIds(evaluationCase, output)).toEqual(
      expect.arrayContaining([
        'unsafe_active_combinations',
        'reaction_barrier_simplification',
      ]),
    );
  });

  it('fails missing SPF protection in daytime cases', () => {
    const evaluationCase = goldenCase('dark_marks_no_spf_gap');
    const output = darkMarksOutput({ includeSpfGap: false });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'daytime_spf_protection',
    );
  });

  it('fails generated medical claim wording', () => {
    const evaluationCase = goldenCase('dark_marks_no_spf_gap');
    const output = darkMarksOutput({ includeSpfGap: true });
    output.explanation.body = ['This will treat and cure dark marks.'];

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'medical_claim_language',
    );
  });

  it('fails generated sensitive profile and location disclosure', () => {
    const evaluationCase = goldenCase('dark_marks_no_spf_gap');
    const output = darkMarksOutput({ includeSpfGap: true });
    output.explanation.inputs = [
      {
        label: 'skin profile',
        detail: 'combination, deep, Black, Fitzpatrick IV, medium sensitivity',
      },
      {
        label: 'location',
        detail: 'Stockholm, SE',
      },
    ];

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'sensitive_profile_disclosure',
    );
  });

  it('fails raw reaction-history internals in explanation inputs', () => {
    const evaluationCase = goldenCase('sensitive_reactive_skin_evening');
    const output = darkMarksOutput({ includeSpfGap: true });
    output.explanation.inputs = [
      {
        label: 'reactionHistory',
        detail: 'fragrance -> redness, stinging, severity moderate',
      },
    ];

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'raw_reaction_history_disclosure',
    );
  });

  it('fails AI-added masks placed after moisturizer', () => {
    const evaluationCase = goldenCase('twelve_product_acne_evening');
    const output = baseOutput({
      steps: [
        step({
          order: 0,
          productId: 'cleanser-1',
          productName: 'Soft Cream Cleanser',
          label: ProductCategory.Cleanser,
        }),
        step({
          order: 1,
          productId: 'azelaic-1',
          productName: 'Azelaic Support Serum',
          label: ProductCategory.Serum,
        }),
        step({
          order: 2,
          productId: 'moisturizer-1',
          productName: 'Barrier Cream',
          label: ProductCategory.Moisturizer,
        }),
        step({
          order: 3,
          productId: 'clay-mask-1',
          productName: 'Calm Clay Mask',
          label: ProductCategory.Mask,
        }),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'practical_step_order',
    );
  });

  it('fails selected products with supplied ingredient layering conflicts', () => {
    const evaluationCase = goldenCase(
      'tolerated_vitamin_c_morning_not_crowded_out',
    );
    const output = baseOutput({
      steps: [
        step({
          order: 0,
          productId: 'vitamin-c-1',
          productName: 'Ascorbyl Glucoside Solution 12%',
          label: ProductCategory.Serum,
        }),
        step({
          order: 1,
          productId: 'niacinamide-1',
          productName: 'Niacinamide Serum',
          label: ProductCategory.Serum,
        }),
        step({
          order: 2,
          productId: 'moisturizer-1',
          productName: 'Barrier Cream',
          label: ProductCategory.Moisturizer,
        }),
        step({
          order: 3,
          productId: 'spf-1',
          productName: 'Daily SPF 50',
          label: ProductCategory.SunProtection,
        }),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'ingredient_layering_conflicts',
    );
  });

  it('fails empty action plans when a realistic shelf has required basics', () => {
    const evaluationCase = goldenCase('low_need_maintenance_morning_not_empty');
    const output = baseOutput({
      steps: [],
      gapRecommendations: [],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain('min_step_count');
  });

  it('fails broad-shelf outputs that collapse into basic categories only', () => {
    const evaluationCase = goldenCase('twelve_product_dark_spots_morning');
    const output = baseOutput({
      steps: [
        step({
          order: 0,
          productId: 'cleanser-1',
          productName: 'Soft Cream Cleanser',
          label: ProductCategory.Cleanser,
        }),
        step({
          order: 1,
          productId: 'moisturizer-1',
          productName: 'Barrier Cream',
          label: ProductCategory.Moisturizer,
        }),
        step({
          order: 2,
          productId: 'spf-1',
          productName: 'Daily SPF 50',
          label: ProductCategory.SunProtection,
        }),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'selected_category_coverage',
    );
  });

  it('passes broad-shelf category coverage with an owned toner category', () => {
    const evaluationCase = goldenCase('twelve_product_dark_spots_morning');
    const output = baseOutput({
      steps: [
        step({
          order: 0,
          productId: 'soothing-toner-1',
          productName: 'Soothing Toner',
          label: ProductCategory.Toner,
        }),
        step({
          order: 1,
          productId: 'moisturizer-1',
          productName: 'Barrier Cream',
          label: ProductCategory.Moisturizer,
        }),
        step({
          order: 2,
          productId: 'spf-1',
          productName: 'Daily SPF 50',
          label: ProductCategory.SunProtection,
        }),
      ],
    });

    expect(
      runTodaysSuggestionHardChecks(evaluationCase, output).find(
        (check) => check.id === 'selected_category_coverage',
      ),
    ).toEqual(expect.objectContaining({ passed: true }));
  });

  it('passes broad-shelf category coverage with an owned mask category', () => {
    const evaluationCase = goldenCase('twelve_product_acne_evening');
    const output = baseOutput({
      steps: [
        step({
          order: 0,
          productId: 'clay-mask-1',
          productName: 'Calm Clay Mask',
          label: ProductCategory.Mask,
        }),
        step({
          order: 1,
          productId: 'moisturizer-1',
          productName: 'Barrier Cream',
          label: ProductCategory.Moisturizer,
        }),
      ],
    });

    expect(
      runTodaysSuggestionHardChecks(evaluationCase, output).find(
        (check) => check.id === 'selected_category_coverage',
      ),
    ).toEqual(expect.objectContaining({ passed: true }));
  });

  it('fails products used outside their shelf preferred time', () => {
    const evaluationCase = goldenCase('twelve_product_dark_spots_morning');
    const output = baseOutput({
      steps: [
        step({
          order: 0,
          productId: 'retinoid-1',
          productName: 'Retinol Night Serum',
          label: ProductCategory.Treatment,
        }),
      ],
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'preferred_time_compatibility',
    );
  });

  it('fails deterministic fallback output even when the final steps are safe', () => {
    const evaluationCase = goldenCase('low_need_maintenance_morning_not_empty');
    const output = baseOutput({
      metadata: {
        ...baseOutput({}).metadata,
        provider: 'deterministic_baseline',
        fallbackReason: 'unsupported_product_selection',
      },
    });

    expect(failedCheckIds(evaluationCase, output)).toContain(
      'no_deterministic_fallback',
    );
  });
});

describe("Today's Suggestion evaluation judge", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const rubricText = JSON.stringify({
    answersQuestion: 5,
    beginnerClarity: 5,
    personalization: 5,
    gapQuality: 5,
    safetyConfidence: 5,
    passed: true,
    explanations: ['Clear and safe.'],
  });

  function judgeConfig() {
    return {
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'sk-test';
        if (key === 'SUGGESTION_AI_MODEL') return 'gpt-4.1-mini';
        return null;
      }),
    } as unknown as import('@nestjs/config').ConfigService;
  }

  function judgeTextResponse(text: string) {
    return {
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: [{ content: [{ type: 'output_text', text }] }],
      }),
    };
  }

  function judgeErrorResponse(status: number) {
    return {
      ok: false,
      status,
      headers: {
        get: jest.fn((name: string) =>
          name.toLowerCase() === 'retry-after' ? '0' : null,
        ),
      },
      text: jest
        .fn()
        .mockResolvedValue(
          JSON.stringify({ error: { message: 'temporary judge outage' } }),
        ),
    };
  }

  function judgeInput() {
    return {
      evaluationCase: goldenCase('dark_marks_no_spf_gap'),
      output: darkMarksOutput({ includeSpfGap: true }),
    };
  }

  it('retries transient judge failures before succeeding', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(judgeErrorResponse(429))
      .mockResolvedValueOnce(judgeErrorResponse(500))
      .mockResolvedValueOnce(judgeTextResponse(rubricText));
    global.fetch = fetchMock;

    const judge = new OpenAiTodaysSuggestionEvaluationJudge(judgeConfig());
    const rubric = await judge.judge(judgeInput());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(rubric.passed).toBe(true);
    expect(rubric.safetyConfidence).toBe(5);
  });

  it('retries invalid judge JSON before succeeding', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(judgeTextResponse('not valid json'))
      .mockResolvedValueOnce(judgeTextResponse(rubricText));
    global.fetch = fetchMock;

    const judge = new OpenAiTodaysSuggestionEvaluationJudge(judgeConfig());
    const rubric = await judge.judge(judgeInput());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rubric.passed).toBe(true);
  });

  it('does not retry non-retryable judge request errors', async () => {
    const fetchMock = jest.fn().mockResolvedValue(judgeErrorResponse(400));
    global.fetch = fetchMock;

    const judge = new OpenAiTodaysSuggestionEvaluationJudge(judgeConfig());

    await expect(judge.judge(judgeInput())).rejects.toThrow(
      'OpenAI evaluation judge failed (400)',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Today's Suggestion evaluation reporting", () => {
  const passingJudge: TodaysSuggestionEvaluationJudge = {
    judge: jest.fn().mockResolvedValue({
      answersQuestion: 5,
      beginnerClarity: 5,
      personalization: 5,
      gapQuality: 5,
      safetyConfidence: 5,
      passed: true,
      explanations: ['Clear and safe.'],
    }),
  };

  it.each([
    [
      'invented-product',
      'dark_marks_no_spf_gap',
      () => {
        const output = darkMarksOutput({ includeSpfGap: true });
        output.steps[0].inventoryProductId = 'invented-product';
        return output;
      },
    ],
    [
      'locked-step mutation',
      'specialist_locked_step',
      () =>
        baseOutput({
          steps: [
            step({
              order: 0,
              routineStepId: 'locked-adapalene-step',
              productId: 'bha-1',
              productName: 'BHA 2% Liquid',
              label: ProductCategory.Exfoliant,
              provenance: SuggestionStepProvenance.AiAdded,
            }),
          ],
          safetyFlags: [
            safetyFlag('Keep specialist-directed steps unchanged.', [
              SuggestionEvidenceSourceId.AadRetinoidRetinol,
            ]),
          ],
        }),
    ],
    [
      'unsafe-active',
      'recent_barrier_reaction',
      () =>
        baseOutput({
          steps: [
            step({
              order: 0,
              productId: 'retinoid-1',
              productName: 'Retinol Night Serum',
              label: ProductCategory.Treatment,
            }),
          ],
        }),
    ],
    [
      'missing-SPF',
      'dark_marks_no_spf_gap',
      () => darkMarksOutput({ includeSpfGap: false }),
    ],
    [
      'medical-claim',
      'dark_marks_no_spf_gap',
      () => {
        const output = darkMarksOutput({ includeSpfGap: true });
        output.safetyFlags = [
          safetyFlag('This treatment cures hyperpigmentation.', [
            SuggestionEvidenceSourceId.AadSunscreenSelection,
          ]),
        ];
        return output;
      },
    ],
  ])(
    'marks mocked generator failure for %s',
    async (_label, caseId, makeOutput) => {
      const report = await evaluateTodaysSuggestionGoldenCases({
        generator: { generate: jest.fn().mockResolvedValue(makeOutput()) },
        judge: passingJudge,
        model: 'gpt-4.1-mini',
        generatedAt: '2026-05-18T08:00:00.000Z',
        cases: [goldenCase(caseId)],
      });

      expect(report.failedCases).toBe(1);
      expect(report.cases[0].status).toBe('failed');
      expect(report.cases[0].hardCheckFailures.length).toBeGreaterThan(0);
    },
  );

  it('marks AI rubric failures as failed even when hard checks pass', async () => {
    const failingJudge: TodaysSuggestionEvaluationJudge = {
      judge: jest.fn().mockResolvedValue({
        answersQuestion: 5,
        beginnerClarity: 5,
        personalization: 3,
        gapQuality: 5,
        safetyConfidence: 5,
        passed: false,
        explanations: ['Not personalized enough.'],
      }),
    };

    const report = await evaluateTodaysSuggestionGoldenCases({
      generator: {
        generate: jest.fn().mockResolvedValue(
          darkMarksOutput({
            includeSpfGap: true,
          }),
        ),
      },
      judge: failingJudge,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-05-18T08:00:00.000Z',
      cases: [goldenCase('dark_marks_no_spf_gap')],
    });

    expect(report.failedCases).toBe(1);
    expect(report.cases[0].status).toBe('failed');
  });

  it('retries transient provider fallback before accepting an evaluation output', async () => {
    const retryableFallback = darkMarksOutput({ includeSpfGap: true });
    retryableFallback.metadata.provider = 'deterministic_baseline';
    retryableFallback.metadata.fallbackReason = 'provider_failure';
    const recoveredOutput = darkMarksOutput({ includeSpfGap: true });
    const generate = jest
      .fn()
      .mockResolvedValueOnce(retryableFallback)
      .mockResolvedValueOnce(recoveredOutput);

    const report = await evaluateTodaysSuggestionGoldenCases({
      generator: { generate },
      judge: passingJudge,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-05-18T08:00:00.000Z',
      cases: [goldenCase('dark_marks_no_spf_gap')],
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(report.failedCases).toBe(0);
    expect(report.cases[0]).toEqual(
      expect.objectContaining({
        status: 'passed',
        fallbackUsed: false,
        fallbackReason: null,
      }),
    );
  });

  it('fails if provider fallback persists after evaluation retries', async () => {
    const retryableFallback = darkMarksOutput({ includeSpfGap: true });
    retryableFallback.metadata.provider = 'deterministic_baseline';
    retryableFallback.metadata.fallbackReason = 'provider_failure';
    const generate = jest.fn().mockResolvedValue(retryableFallback);

    const report = await evaluateTodaysSuggestionGoldenCases({
      generator: { generate },
      judge: passingJudge,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-05-18T08:00:00.000Z',
      cases: [goldenCase('dark_marks_no_spf_gap')],
    });

    expect(generate).toHaveBeenCalledTimes(3);
    expect(report.failedCases).toBe(1);
    expect(report.cases[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        fallbackUsed: true,
        fallbackReason: 'provider_failure',
      }),
    );
    expect(report.cases[0].hardCheckFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'no_deterministic_fallback' }),
      ]),
    );
  });

  it('includes applied product history in judge case summaries', async () => {
    const report = await evaluateTodaysSuggestionGoldenCases({
      generator: {
        generate: jest.fn().mockResolvedValue(
          baseOutput({
            steps: [
              step({
                order: 0,
                productId: 'cleanser-1',
                productName: 'Soft Cream Cleanser',
                label: ProductCategory.Cleanser,
              }),
              step({
                order: 1,
                productId: 'spf-1',
                productName: 'Daily SPF 50',
                label: ProductCategory.SunProtection,
              }),
            ],
          }),
        ),
      },
      judge: passingJudge,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-05-18T08:00:00.000Z',
      cases: [goldenCase('acne_pigment_priority_conflict')],
    });
    const summary = report.cases[0].sanitizedCaseSummary as {
      contextSignals: {
        appliedProductHistory: {
          products: Array<{
            productId: string;
            lastAppliedDate: string | null;
          }>;
        };
      };
    };

    expect(summary.contextSignals.appliedProductHistory.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'bha-1',
          lastAppliedDate: '2026-05-17',
        }),
      ]),
    );
  });

  it('includes medication safety context in judge case summaries', async () => {
    const report = await evaluateTodaysSuggestionGoldenCases({
      generator: {
        generate: jest.fn().mockResolvedValue(
          baseOutput({
            steps: [
              step({
                order: 0,
                productId: 'cleanser-1',
                productName: 'Soft Cream Cleanser',
                label: ProductCategory.Cleanser,
              }),
              step({
                order: 1,
                productId: 'moisturizer-1',
                productName: 'Barrier Cream',
                label: ProductCategory.Moisturizer,
              }),
            ],
          }),
        ),
      },
      judge: passingJudge,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-05-18T08:00:00.000Z',
      cases: [goldenCase('medication_active_caution')],
    });
    const summary = report.cases[0].sanitizedCaseSummary as {
      skinProfile: {
        safetyContext: {
          medications: string[];
          photosensitizingOther: boolean;
        };
      };
    };

    expect(summary.skinProfile.safetyContext.medications).toEqual([
      'oral acne medication',
    ]);
    expect(summary.skinProfile.safetyContext.photosensitizingOther).toBe(true);
  });

  it('includes routine preferences and active tolerances in judge case summaries', async () => {
    const report = await evaluateTodaysSuggestionGoldenCases({
      generator: {
        generate: jest.fn().mockResolvedValue(
          baseOutput({
            steps: [
              step({
                order: 0,
                productId: 'cleanser-1',
                productName: 'Soft Cream Cleanser',
                label: ProductCategory.Cleanser,
              }),
              step({
                order: 1,
                productId: 'niacinamide-1',
                productName: 'Niacinamide Serum',
                label: ProductCategory.Serum,
              }),
              step({
                order: 2,
                productId: 'moisturizer-1',
                productName: 'Barrier Cream',
                label: ProductCategory.Moisturizer,
              }),
            ],
          }),
        ),
      },
      judge: passingJudge,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-05-18T08:00:00.000Z',
      cases: [goldenCase('twelve_product_texture_evening')],
    });
    const summary = report.cases[0].sanitizedCaseSummary as {
      skinProfile: {
        activeTolerances: Record<string, unknown>;
        routinePreferences: Record<string, unknown>;
      };
    };

    expect(summary.skinProfile.activeTolerances).toMatchObject({
      aha: { tolerance: 'low' },
      retinoid: { tolerance: 'low' },
    });
    expect(summary.skinProfile.routinePreferences).toMatchObject({
      max_active_nights_per_week: 2,
    });
  });

  it('includes supplied skin behavior in judge case summaries', async () => {
    const report = await evaluateTodaysSuggestionGoldenCases({
      generator: {
        generate: jest.fn().mockResolvedValue(
          darkMarksOutput({
            includeSpfGap: true,
          }),
        ),
      },
      judge: passingJudge,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-05-18T08:00:00.000Z',
      cases: [goldenCase('dark_marks_no_spf_gap')],
    });
    const summary = report.cases[0].sanitizedCaseSummary as {
      skinProfile: {
        skinBehavior: Record<string, unknown>;
      };
    };

    expect(summary.skinProfile.skinBehavior).toMatchObject({
      pihTendency: 'high',
      sunscreenHabit: 'inconsistent',
    });
  });

  it('records repeatability variation without failing when repeated outputs stay valid', async () => {
    const first = darkMarksOutput({ includeSpfGap: true });
    const second = darkMarksOutput({ includeSpfGap: true });
    second.steps = [
      step({
        order: 0,
        productId: 'azelaic-1',
        productName: 'Azelaic Support Serum',
        label: ProductCategory.Serum,
      }),
      step({
        order: 1,
        productId: 'moisturizer-1',
        productName: 'Barrier Cream',
        label: ProductCategory.Moisturizer,
      }),
    ];

    const report = await evaluateTodaysSuggestionGoldenCases({
      generator: {
        generate: jest
          .fn()
          .mockResolvedValueOnce(first)
          .mockResolvedValueOnce(second),
      },
      judge: passingJudge,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-05-18T08:00:00.000Z',
      cases: [goldenCase('dark_marks_no_spf_gap')],
      repeatabilityRuns: 2,
    });

    expect(report.failedCases).toBe(0);
    expect(report.repeatabilityFailures).toBe(0);
    expect(report.cases[0].repeatability.variations[0]).toEqual(
      expect.objectContaining({
        run: 2,
        reason:
          'Repeated output action plan differs but still passes hard checks.',
      }),
    );
  });

  it('fails repeatability when a repeated output violates hard checks', async () => {
    const first = darkMarksOutput({ includeSpfGap: true });
    const second = darkMarksOutput({ includeSpfGap: false });

    const report = await evaluateTodaysSuggestionGoldenCases({
      generator: {
        generate: jest
          .fn()
          .mockResolvedValueOnce(first)
          .mockResolvedValueOnce(second),
      },
      judge: passingJudge,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-05-18T08:00:00.000Z',
      cases: [goldenCase('dark_marks_no_spf_gap')],
      repeatabilityRuns: 2,
    });

    expect(report.failedCases).toBe(1);
    expect(report.repeatabilityFailures).toBe(1);
    expect(report.cases[0].hardCheckFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'repeatability_hard_checks' }),
      ]),
    );
    expect(report.cases[0].repeatability.mismatches[0]).toEqual(
      expect.objectContaining({
        run: 2,
        reason: 'Repeated output failed hard checks.',
      }),
    );
  });

  it('redacts obvious secrets from report content', () => {
    const secret = 'sk-test_1234567890abcdef';
    const sanitized = sanitizeEvaluationText(
      `OPENAI_API_KEY=${secret} token="abc123" AWS_SECRET_ACCESS_KEY=hunter2`,
    );

    expect(sanitized).not.toContain(secret);
    expect(sanitized).not.toContain('abc123');
    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).toContain('[redacted');
  });

  it('does not redact product ids that merely contain sk hyphen text', () => {
    const sanitized = sanitizeEvaluationText('mask-fragrance-1 clay-mask-1');

    expect(sanitized).toBe('mask-fragrance-1 clay-mask-1');
  });

  it('sanitizes nested report objects', () => {
    const sanitized = sanitizeForReport({
      nested: {
        message: 'apiKey="super-secret-value"',
      },
    });

    expect(sanitized.nested.message).not.toContain('super-secret-value');
  });
});

function failedCheckIds(
  evaluationCase: TodaysSuggestionEvaluationCase,
  output: SuggestionGenerationOutput,
): string[] {
  return runTodaysSuggestionHardChecks(evaluationCase, output)
    .filter((check) => !check.passed)
    .map((check) => check.id);
}

function goldenCase(id: string): TodaysSuggestionEvaluationCase {
  const evaluationCase = TODAYS_SUGGESTION_GOLDEN_CASES.find(
    (candidate) => candidate.id === id,
  );
  if (!evaluationCase) throw new Error(`Missing golden case ${id}`);
  return evaluationCase;
}

function darkMarksOutput(input: {
  includeSpfGap: boolean;
}): SuggestionGenerationOutput {
  return baseOutput({
    steps: [
      step({
        order: 0,
        productId: 'cleanser-1',
        productName: 'Soft Cream Cleanser',
        label: ProductCategory.Cleanser,
      }),
      step({
        order: 1,
        productId: 'moisturizer-1',
        productName: 'Barrier Cream',
        label: ProductCategory.Moisturizer,
      }),
    ],
    gapRecommendations: input.includeSpfGap
      ? [
          {
            ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
            reason: 'Daytime dark mark goals need daily sunscreen coverage.',
            budgetTier: null,
            goalAlignment: 'fade post-breakout dark marks',
            sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
          },
        ]
      : [],
  });
}

function baseOutput(
  overrides: Partial<SuggestionGenerationOutput>,
): SuggestionGenerationOutput {
  return {
    mode: SuggestionMode.Ai,
    hasReactionSignal: false,
    simplifiedForReaction: false,
    explanation: {
      headline: 'Simple shelf plan',
      body: ['Use a gentle routine today and keep the focus practical.'],
      perStepReasons: [],
      skipped: [],
      inputs: [
        {
          label: 'Evidence',
          detail: 'Trusted safety sources informed the suggestion.',
        },
      ],
    },
    gapRecommendations: [],
    safetyFlags: [],
    steps: [
      step({
        order: 0,
        productId: 'moisturizer-1',
        productName: 'Barrier Cream',
        label: ProductCategory.Moisturizer,
      }),
    ],
    metadata: {
      model: 'gpt-4.1-mini',
      promptVersion: SUGGESTION_PROMPT_VERSION,
      provider: 'openai',
      fallbackReason: null,
      inputTokens: 100,
      outputTokens: 100,
      totalTokens: 200,
      estimatedCostUsd: 0.001,
      durationMs: 1000,
    },
    ...overrides,
  };
}

function step(input: {
  order: number;
  productId: string;
  productName: string;
  label: ProductCategory;
  routineStepId?: string | null;
  provenance?: SuggestionStepProvenance;
}): SuggestionGenerationStepOutput {
  return {
    stepOrder: input.order,
    routineStepId: input.routineStepId ?? null,
    inventoryProductId: input.productId,
    productBrand: input.productId.startsWith('rx-') ? 'Derm Clinic' : 'Ava Lab',
    productName: input.productName,
    stepLabel: input.label,
    customLabel: null,
    applicationMethod: 'fingertips',
    quantity: 'pea-size',
    waitAfterMinutes: null,
    explanation: "Fits today's shelf context.",
    routineNote: null,
    provenance: input.provenance ?? SuggestionStepProvenance.AiAdded,
    chips: [],
    safetyWarnings: [],
  };
}

function safetyFlag(
  message: string,
  sourceIds: SuggestionEvidenceSourceId[],
): SuggestionGenerationOutput['safetyFlags'][number] {
  return {
    severity: 'info',
    message,
    ingredientSlugs: [],
    sourceIds,
  };
}
