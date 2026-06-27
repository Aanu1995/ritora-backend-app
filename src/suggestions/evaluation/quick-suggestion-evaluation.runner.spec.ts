import { ConfigService } from '@nestjs/config';
import {
  QUICK_SUGGESTION_CATEGORY_OPEN_CASE_ID,
  QUICK_SUGGESTION_GOLDEN_CASES,
  QUICK_SUGGESTION_NO_STEP_CASE_ID,
  QUICK_SUGGESTION_PLAIN_SKIP_CASE_ID,
  QUICK_SUGGESTION_TOLERATED_RETINOID_CASE_ID,
} from './quick-suggestion-golden-cases';
import {
  createLiveQuickSuggestionEvaluationRunner,
  evaluateQuickSuggestionGoldenCases,
  OpenAiQuickSuggestionEvaluationJudge,
  runQuickSuggestionHardChecks,
} from './quick-suggestion-evaluation.runner';
import {
  SUGGESTION_PROMPT_VERSION,
  SuggestionMode,
  SuggestionEvidenceSourceId,
  SuggestionRequestSource,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import { ProductCategory } from '../../shelf/shelf.types';
import type { SuggestionGenerationOutput } from '../services/suggestion-ai-generator';

describe('Quick Suggestion evaluation runner', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses an independent on-demand-only case set with a zero-step case', () => {
    expect(QUICK_SUGGESTION_GOLDEN_CASES.length).toBeGreaterThan(0);
    expect(
      QUICK_SUGGESTION_GOLDEN_CASES.every(
        (evaluationCase) =>
          evaluationCase.inputs.requestSource ===
          SuggestionRequestSource.OnDemand,
      ),
    ).toBe(true);
    expect(
      QUICK_SUGGESTION_GOLDEN_CASES.some(
        (evaluationCase) =>
          evaluationCase.id === QUICK_SUGGESTION_NO_STEP_CASE_ID,
      ),
    ).toBe(true);
    expect(
      QUICK_SUGGESTION_GOLDEN_CASES.some(
        (evaluationCase) =>
          evaluationCase.id === QUICK_SUGGESTION_PLAIN_SKIP_CASE_ID,
      ),
    ).toBe(true);
    expect(
      QUICK_SUGGESTION_GOLDEN_CASES.some(
        (evaluationCase) =>
          evaluationCase.id === QUICK_SUGGESTION_CATEGORY_OPEN_CASE_ID,
      ),
    ).toBe(true);
  });

  it('requires a plain-skipped SPF to remain selectable for a daytime quick suggestion', () => {
    const evaluationCase = plainSkipCase();

    const failingChecks = runQuickSuggestionHardChecks(
      evaluationCase,
      quickOutput(),
    );
    expect(failingChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'expected_product_ids',
          passed: false,
          failures: expect.arrayContaining([
            'Required product not selected: plain-skip-spf-1.',
          ]),
        }),
      ]),
    );

    const passingChecks = runQuickSuggestionHardChecks(
      evaluationCase,
      quickOutput({
        steps: [
          {
            stepOrder: 0,
            routineStepId: null,
            inventoryProductId: 'plain-skip-spf-1',
            productBrand: 'Ava Lab',
            productName: 'Morning SPF 50',
            stepLabel: ProductCategory.SunProtection,
            customLabel: null,
            applicationMethod: null,
            quantity: null,
            waitAfterMinutes: null,
            explanation: 'Use your SPF now for this daylight request.',
            routineNote: null,
            provenance: SuggestionStepProvenance.AiAdded,
            chips: [],
            safetyWarnings: [],
          },
        ],
      }),
    );
    expect(
      passingChecks.find((check) => check.id === 'expected_product_ids')
        ?.passed,
    ).toBe(true);
    expect(
      passingChecks.find((check) => check.id === 'preferred_time_compatibility')
        ?.passed,
    ).toBe(true);
  });

  it('fails a zero-step quick suggestion when no user-facing explanation is present', () => {
    const evaluationCase = QUICK_SUGGESTION_GOLDEN_CASES.find(
      (candidate) => candidate.id === QUICK_SUGGESTION_NO_STEP_CASE_ID,
    );
    expect(evaluationCase).toBeDefined();

    const checks = runQuickSuggestionHardChecks(
      evaluationCase!,
      quickOutput({
        explanation: {
          headline: '',
          body: [],
          perStepReasons: [],
          skipped: [],
          inputs: [],
        },
      }),
    );

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'quick_no_step_outcome',
          passed: false,
        }),
      ]),
    );
  });

  it('fails category-open quick suggestions that collapse to basic categories only', () => {
    const evaluationCase = categoryOpenCase();

    const checks = runQuickSuggestionHardChecks(
      evaluationCase,
      quickOutput({
        steps: [
          quickStep(0, 'quick-cleanser-1', ProductCategory.Cleanser),
          quickStep(1, 'quick-moisturizer-1', ProductCategory.Moisturizer),
        ],
      }),
    );

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'selected_category_coverage',
          passed: false,
        }),
      ]),
    );
  });

  it('passes category-open quick suggestions with an owned uploaded support category', () => {
    const evaluationCase = categoryOpenCase();

    const checks = runQuickSuggestionHardChecks(
      evaluationCase,
      quickOutput({
        steps: [quickStep(0, 'quick-toner-1', ProductCategory.Toner)],
      }),
    );

    expect(
      checks.find((check) => check.id === 'selected_category_coverage'),
    ).toEqual(expect.objectContaining({ passed: true }));
  });

  it('inherits the selected-step skipped-copy hard check', () => {
    const evaluationCase = categoryOpenCase();

    const checks = runQuickSuggestionHardChecks(
      evaluationCase,
      quickOutput({
        explanation: {
          headline: 'Quick gym reset',
          body: ['Skipped moisturizer to keep this quick.'],
          perStepReasons: [],
          skipped: [],
          inputs: [],
        },
        steps: [
          quickStep(0, 'quick-moisturizer-1', ProductCategory.Moisturizer),
        ],
      }),
    );

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'selected_step_skip_copy',
          passed: false,
        }),
      ]),
    );
  });

  it('fails skipped copy that renames an owned product with a near-match alias', () => {
    const evaluationCase = QUICK_SUGGESTION_GOLDEN_CASES.find(
      (candidate) =>
        candidate.id === QUICK_SUGGESTION_TOLERATED_RETINOID_CASE_ID,
    );
    expect(evaluationCase).toBeDefined();

    const checks = runQuickSuggestionHardChecks(
      evaluationCase!,
      quickOutput({
        explanation: {
          headline: 'Evening active',
          body: ['Use one active tonight.'],
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
          quickStep(0, 'quick-moisturizer-1', ProductCategory.Moisturizer),
        ],
      }),
    );

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'skipped_product_names',
          passed: false,
          failures: expect.arrayContaining([
            expect.stringContaining('Ava Lab 1% Retinol care'),
          ]),
        }),
      ]),
    );
  });

  it('passes a zero-step quick suggestion that clearly says nothing is needed now', async () => {
    const evaluationCase = QUICK_SUGGESTION_GOLDEN_CASES.find(
      (candidate) => candidate.id === QUICK_SUGGESTION_NO_STEP_CASE_ID,
    );
    expect(evaluationCase).toBeDefined();

    const report = await evaluateQuickSuggestionGoldenCases({
      model: 'test-model',
      cases: [evaluationCase!],
      generator: {
        generate: jest.fn().mockResolvedValue(quickOutput()),
      },
      judge: {
        judge: jest.fn().mockResolvedValue({
          answersQuestion: 5,
          beginnerClarity: 5,
          personalization: 5,
          gapQuality: 5,
          safetyConfidence: 5,
          passed: true,
          explanations: ['Clear no-step outcome.'],
        }),
      },
      generatedAt: '2026-05-29T08:00:00.000Z',
    });

    expect(report.reportType).toBe('quick_suggestion_live_ai_evaluation');
    expect(report.passedCases).toBe(1);
    expect(report.failedCases).toBe(0);
    expect(report.cases[0]?.hardCheckFailures).toEqual([]);
    expect(report.cases[0]?.sanitizedCaseSummary).toEqual(
      expect.objectContaining({
        ownedProducts: expect.arrayContaining([
          expect.objectContaining({
            productId: 'morning-spf-only',
            brand: 'Ava Lab',
            name: 'Morning SPF 50',
            fullName: 'Ava Lab Morning SPF 50',
          }),
        ]),
      }),
    );
  });

  it('includes plain skip history in sanitized quick case summaries', async () => {
    const evaluationCase = plainSkipCase();

    const report = await evaluateQuickSuggestionGoldenCases({
      model: 'test-model',
      cases: [evaluationCase],
      generator: {
        generate: jest.fn().mockResolvedValue(
          quickOutput({
            steps: [
              {
                stepOrder: 0,
                routineStepId: null,
                inventoryProductId: 'plain-skip-spf-1',
                productBrand: 'Ava Lab',
                productName: 'Morning SPF 50',
                stepLabel: ProductCategory.SunProtection,
                customLabel: null,
                applicationMethod: null,
                quantity: null,
                waitAfterMinutes: null,
                explanation: 'Use your SPF now for this daylight request.',
                routineNote: null,
                provenance: SuggestionStepProvenance.AiAdded,
                chips: [],
                safetyWarnings: [],
              },
            ],
          }),
        ),
      },
      judge: passingJudge(),
      generatedAt: '2026-05-29T08:00:00.000Z',
    });

    expect(report.failedCases).toBe(0);
    expect(report.cases[0]?.sanitizedCaseSummary).toEqual(
      expect.objectContaining({
        recentApplications: [
          expect.objectContaining({
            items: [
              expect.objectContaining({
                productId: 'plain-skip-spf-1',
                noteKind: 'plain_non_reaction',
              }),
            ],
          }),
        ],
        routineMemory: expect.objectContaining({
          skippedProducts: { 'plain-skip-spf-1': 1 },
        }),
      }),
    );
  });

  it('records generation failures as failed cases', async () => {
    const evaluationCase = noStepCase();

    const report = await evaluateQuickSuggestionGoldenCases({
      model: 'test-model',
      cases: [evaluationCase],
      generator: {
        generate: jest.fn().mockRejectedValue(new Error('generator down')),
      },
      judge: passingJudge(),
      generatedAt: '2026-05-29T08:00:00.000Z',
    });

    expect(report.passedCases).toBe(0);
    expect(report.failedCases).toBe(1);
    expect(report.cases[0]?.hardCheckFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'quick_generation_execution',
          failures: ['generator down'],
        }),
      ]),
    );
  });

  it('records judge and repeatability failures without dropping the case report', async () => {
    const evaluationCase = noStepCase();
    const generator = jest
      .fn()
      .mockResolvedValueOnce(quickOutput())
      .mockResolvedValueOnce(
        quickOutput({
          explanation: {
            headline: '',
            body: [],
            perStepReasons: [],
            skipped: [],
            inputs: [],
          },
        }),
      );

    const report = await evaluateQuickSuggestionGoldenCases({
      model: 'test-model',
      cases: [evaluationCase],
      repeatabilityRuns: 2,
      generator: { generate: generator },
      judge: {
        judge: jest.fn().mockRejectedValue(new Error('judge unavailable')),
      },
      generatedAt: '2026-05-29T08:00:00.000Z',
    });

    expect(report.passedCases).toBe(0);
    expect(report.failedCases).toBe(1);
    expect(report.repeatabilityFailures).toBe(1);
    expect(report.cases[0]?.hardCheckFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'quick_ai_judge_execution' }),
        expect.objectContaining({ id: 'quick_repeatability_hard_checks' }),
      ]),
    );
  });

  it('fails a no-extra-step quick suggestion when it adds a gap recommendation', () => {
    const evaluationCase = QUICK_SUGGESTION_GOLDEN_CASES.find(
      (candidate) => candidate.id === QUICK_SUGGESTION_NO_STEP_CASE_ID,
    );
    expect(evaluationCase).toBeDefined();

    const checks = runQuickSuggestionHardChecks(
      evaluationCase!,
      quickOutput({
        gapRecommendations: [
          {
            ingredientOrCategory: 'moisturizer',
            reason: 'Buy one just in case.',
            budgetTier: 'starter',
            goalAlignment: null,
            sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
          },
        ],
      }),
    );

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'quick_no_step_outcome',
          passed: false,
        }),
      ]),
    );
  });

  it('creates a live runner from the configured suggestion model', () => {
    const runner = createLiveQuickSuggestionEvaluationRunner(
      configService({
        OPENAI_API_KEY: 'test-key',
        SUGGESTION_AI_MODEL: 'gpt-test',
      }),
    );

    expect(runner.model).toBe('gpt-test');
    expect(runner.promptVersion).toBe(SUGGESTION_PROMPT_VERSION);
    expect(runner.generator).toBeDefined();
    expect(runner.judge).toBeInstanceOf(OpenAiQuickSuggestionEvaluationJudge);
  });

  it('rejects OpenAI judge calls when configuration is missing', async () => {
    const judge = new OpenAiQuickSuggestionEvaluationJudge(configService({}));

    await expect(
      judge.judge({ evaluationCase: noStepCase(), output: quickOutput() }),
    ).rejects.toThrow(
      'OpenAI quick suggestion evaluation configuration is missing.',
    );
  });

  it('retries empty OpenAI judge output and normalizes rubric values', async () => {
    const fetchSpy = jest
      .fn()
      .mockResolvedValueOnce(openAiResponse({ output: [{ content: [] }] }))
      .mockResolvedValueOnce(
        openAiResponse({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    answersQuestion: 4.7,
                    beginnerClarity: -2,
                    personalization: 'bad',
                    gapQuality: 3,
                    safetyConfidence: 10,
                    passed: true,
                    explanations: [1, 'normalized'],
                  }),
                },
              ],
            },
          ],
        }),
      );
    global.fetch = fetchSpy;

    const judge = new OpenAiQuickSuggestionEvaluationJudge(
      configService({
        OPENAI_API_KEY: 'test-key',
        SUGGESTION_AI_MODEL: 'gpt-test',
      }),
    );

    const result = await judge.judge({
      evaluationCase: noStepCase(),
      output: quickOutput(),
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const requestBody = parseOpenAiRequestBody(fetchSpy.mock.calls[1]?.[1]);
    const systemPrompt =
      requestBody.input?.find((message) => message.role === 'system')
        ?.content?.[0]?.text ?? '';
    expect(systemPrompt).toContain('on-demand right-now skincare answer');
    expect(systemPrompt).toContain('do not judge it as a full daily routine');
    expect(systemPrompt).toContain(
      'A zero-step output can pass when it clearly says no extra product is needed now',
    );
    expect(systemPrompt).toContain('product preferredTime/daypart compliance');
    expect(systemPrompt).toContain(
      'Use ownedProducts productId, brand, name, and fullName fields',
    );
    expect(systemPrompt).toContain(
      'preferredTime=morning is valid in morning or noon dayparts',
    );
    expect(systemPrompt).toContain(
      'Plain skipped history means the user did not apply a product',
    );
    expect(systemPrompt).toContain(
      'Skipped/explanation copy may reference owned products',
    );
    expect(systemPrompt).toContain(
      'compatible owned products outside cleanser/moisturizer/sun-protection',
    );
    expect(systemPrompt).toContain(
      'toner, essence, mask, and lip-care can be valid',
    );
    expect(systemPrompt).toContain(
      'add a routine step merely to avoid an empty result',
    );
    expect(result).toEqual({
      answersQuestion: 5,
      beginnerClarity: 0,
      personalization: 0,
      gapQuality: 3,
      safetyConfidence: 5,
      passed: true,
      explanations: ['1', 'normalized'],
    });
  });

  it('surfaces non-OK OpenAI judge responses', async () => {
    global.fetch = jest.fn().mockResolvedValue(openAiResponse({}, false, 429));
    const judge = new OpenAiQuickSuggestionEvaluationJudge(
      configService({
        OPENAI_API_KEY: 'test-key',
        SUGGESTION_AI_MODEL: 'gpt-test',
      }),
    );

    await expect(
      judge.judge({ evaluationCase: noStepCase(), output: quickOutput() }),
    ).rejects.toThrow('OpenAI quick suggestion evaluation judge failed (429).');
  });
});

function noStepCase() {
  const evaluationCase = QUICK_SUGGESTION_GOLDEN_CASES.find(
    (candidate) => candidate.id === QUICK_SUGGESTION_NO_STEP_CASE_ID,
  );
  expect(evaluationCase).toBeDefined();
  return evaluationCase!;
}

function plainSkipCase() {
  const evaluationCase = QUICK_SUGGESTION_GOLDEN_CASES.find(
    (candidate) => candidate.id === QUICK_SUGGESTION_PLAIN_SKIP_CASE_ID,
  );
  expect(evaluationCase).toBeDefined();
  return evaluationCase!;
}

function categoryOpenCase() {
  const evaluationCase = QUICK_SUGGESTION_GOLDEN_CASES.find(
    (candidate) => candidate.id === QUICK_SUGGESTION_CATEGORY_OPEN_CASE_ID,
  );
  expect(evaluationCase).toBeDefined();
  return evaluationCase!;
}

function quickStep(
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
    explanation: 'Use this owned product now.',
    routineNote: null,
    provenance: SuggestionStepProvenance.AiAdded,
    chips: [],
    safetyWarnings: [],
  };
}

function passingJudge() {
  return {
    judge: jest.fn().mockResolvedValue({
      answersQuestion: 5,
      beginnerClarity: 5,
      personalization: 5,
      gapQuality: 5,
      safetyConfidence: 5,
      passed: true,
      explanations: ['Clear no-step outcome.'],
    }),
  };
}

interface OpenAiRequestBodyForTest {
  input?: {
    role?: string;
    content?: { text?: string }[];
  }[];
}

function parseOpenAiRequestBody(init: unknown): OpenAiRequestBodyForTest {
  if (!isRequestInitWithStringBody(init)) return {};
  return JSON.parse(init.body) as OpenAiRequestBodyForTest;
}

function isRequestInitWithStringBody(
  value: unknown,
): value is RequestInit & { body: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'body' in value &&
    typeof (value as { body?: unknown }).body === 'string'
  );
}

function configService(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key] ?? null),
  } as unknown as ConfigService;
}

function openAiResponse(
  payload: object,
  ok = true,
  status = 200,
): Pick<Response, 'json' | 'ok' | 'status'> {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(payload),
  };
}

function quickOutput(
  partial: Partial<SuggestionGenerationOutput> = {},
): SuggestionGenerationOutput {
  return {
    mode: SuggestionMode.Ai,
    hasReactionSignal: false,
    simplifiedForReaction: false,
    explanation: {
      headline: 'No extra step needed',
      body: ['Your skin does not need another shelf product right now.'],
      perStepReasons: [],
      skipped: [],
      inputs: [],
    },
    gapRecommendations: [],
    safetyFlags: [],
    steps: [],
    metadata: {
      model: 'test-model',
      promptVersion: 'test-prompt',
      provider: 'openai',
      fallbackReason: null,
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      estimatedCostUsd: 0.0001,
      durationMs: 100,
    },
    ...partial,
  };
}
