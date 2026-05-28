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
  TodaysSuggestionEvaluationCase,
} from './todays-suggestion-golden-cases';
import {
  evaluateTodaysSuggestionGoldenCases,
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
