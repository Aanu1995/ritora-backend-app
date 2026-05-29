import { ConfigService } from '@nestjs/config';
import {
  QUICK_SUGGESTION_GOLDEN_CASES,
  QUICK_SUGGESTION_NO_STEP_CASE_ID,
} from './quick-suggestion-golden-cases';
import {
  createLiveQuickSuggestionEvaluationRunner,
  evaluateQuickSuggestionGoldenCases,
  OpenAiQuickSuggestionEvaluationJudge,
  runQuickSuggestionHardChecks,
} from './quick-suggestion-evaluation.runner';
import {
  SuggestionMode,
  SuggestionEvidenceSourceId,
  SuggestionRequestSource,
} from '../suggestions.constants';
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
