import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { readFeatureOpenAiModel } from '../../common/utils/openai-config';
import {
  OPENAI_QUICK_SUGGESTION_REASONING_EFFORT,
  openAiRepeatabilityRequestOptions,
} from '../../common/utils/openai-request-options';
import {
  SUGGESTION_AI_MAX_OUTPUT_TOKENS,
  SUGGESTION_AI_MODEL_ENV_KEY,
  SUGGESTION_AI_TIMEOUT_MS,
  SuggestionAiGenerator,
  type SuggestionGenerationOutput,
} from '../services/suggestion-ai-generator';
import { isReactionRelatedSkipReason } from '../services/suggestion-application-history';
import {
  SUGGESTION_PROMPT_VERSION,
  SuggestionRequestSource,
} from '../suggestions.constants';
import {
  extractOutputText,
  type OpenAiResponsePayload,
} from '../services/suggestion-ai-contract';
import type { TodaysSuggestionEvaluationCase } from './todays-suggestion-golden-cases';
import { QUICK_SUGGESTION_GOLDEN_CASES } from './quick-suggestion-golden-cases';
import {
  runTodaysSuggestionHardChecks,
  sanitizeForReport,
  type TodaysSuggestionHardCheckResult,
  type TodaysSuggestionRubricResult,
} from './todays-suggestion-evaluation.runner';

const QUICK_JUDGE_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'quick_suggestion_evaluation_judge',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'answersQuestion',
      'beginnerClarity',
      'personalization',
      'gapQuality',
      'safetyConfidence',
      'passed',
      'explanations',
    ],
    properties: {
      answersQuestion: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
      beginnerClarity: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
      personalization: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
      gapQuality: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
      safetyConfidence: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
      passed: { type: 'boolean' },
      explanations: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

const QUICK_SUGGESTION_EVALUATION_JUDGE_MAX_OUTPUT_TOKENS = 12000;
const QUICK_SUGGESTION_EVALUATION_JUDGE_ATTEMPTS = 2;
const DEFAULT_CASES = QUICK_SUGGESTION_GOLDEN_CASES;

export type QuickSuggestionEvaluationStatus = 'passed' | 'failed';

export interface QuickSuggestionCaseResult {
  caseId: string;
  title: string;
  status: QuickSuggestionEvaluationStatus;
  hardChecksPassed: number;
  hardChecksTotal: number;
  hardCheckFailures: TodaysSuggestionHardCheckResult[];
  rubric: TodaysSuggestionRubricResult | null;
  model: string;
  promptVersion: string;
  provider: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  driftHash: string;
  generatedAt: string;
  sanitizedCaseSummary: unknown;
  sanitizedOutputSummary: unknown;
}

export interface QuickSuggestionEvaluationReport {
  reportType: 'quick_suggestion_live_ai_evaluation';
  generatedAt: string;
  model: string;
  promptVersion: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  repeatabilityRuns: number;
  repeatabilityFailures: number;
  strict: true;
  cases: QuickSuggestionCaseResult[];
}

export interface QuickSuggestionEvaluationGenerator {
  generate(
    inputs: TodaysSuggestionEvaluationCase['inputs'],
  ): Promise<SuggestionGenerationOutput>;
}

export interface QuickSuggestionEvaluationJudge {
  judge(input: {
    evaluationCase: TodaysSuggestionEvaluationCase;
    output: SuggestionGenerationOutput;
  }): Promise<TodaysSuggestionRubricResult>;
}

export interface QuickSuggestionEvaluationRunnerOptions {
  generator: QuickSuggestionEvaluationGenerator;
  judge: QuickSuggestionEvaluationJudge;
  model: string;
  promptVersion?: string;
  cases?: readonly TodaysSuggestionEvaluationCase[];
  generatedAt?: string;
  repeatabilityRuns?: number;
}

export async function evaluateQuickSuggestionGoldenCases(
  options: QuickSuggestionEvaluationRunnerOptions,
): Promise<QuickSuggestionEvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const cases = options.cases ?? DEFAULT_CASES;
  const repeatabilityRuns = Math.max(1, options.repeatabilityRuns ?? 1);
  const results: QuickSuggestionCaseResult[] = [];

  for (const evaluationCase of cases) {
    results.push(
      await evaluateQuickSuggestionCase({
        evaluationCase,
        generator: options.generator,
        judge: options.judge,
        model: options.model,
        promptVersion: options.promptVersion ?? 'unknown',
        generatedAt,
        repeatabilityRuns,
      }),
    );
  }

  const passedCases = results.filter(
    (result) => result.status === 'passed',
  ).length;
  const repeatabilityFailures = results.filter((result) =>
    result.hardCheckFailures.some(
      (failure) => failure.id === 'quick_repeatability_hard_checks',
    ),
  ).length;

  return sanitizeForReport({
    reportType: 'quick_suggestion_live_ai_evaluation',
    generatedAt,
    model: options.model,
    promptVersion: options.promptVersion ?? 'unknown',
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    repeatabilityRuns,
    repeatabilityFailures,
    strict: true,
    cases: results,
  });
}

export function runQuickSuggestionHardChecks(
  evaluationCase: TodaysSuggestionEvaluationCase,
  output: SuggestionGenerationOutput,
): TodaysSuggestionHardCheckResult[] {
  return [
    ...runTodaysSuggestionHardChecks(evaluationCase, output),
    checkQuickNoStepOutcome(evaluationCase, output),
  ];
}

export class OpenAiQuickSuggestionEvaluationJudge implements QuickSuggestionEvaluationJudge {
  constructor(private readonly configService: ConfigService) {}

  async judge(input: {
    evaluationCase: TodaysSuggestionEvaluationCase;
    output: SuggestionGenerationOutput;
  }): Promise<TodaysSuggestionRubricResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    const model = readFeatureOpenAiModel(
      this.configService,
      SUGGESTION_AI_MODEL_ENV_KEY,
      'gpt-4.1-mini',
    );
    if (!apiKey || !model) {
      throw new Error(
        'OpenAI quick suggestion evaluation configuration is missing.',
      );
    }

    const outputText = await this.requestStructuredJudgement({
      apiKey,
      model,
      input,
    });
    if (!outputText) {
      throw new Error(
        'OpenAI quick suggestion evaluation judge returned no structured output.',
      );
    }
    return normalizeRubric(JSON.parse(outputText));
  }

  private async requestStructuredJudgement(input: {
    apiKey: string;
    model: string;
    input: {
      evaluationCase: TodaysSuggestionEvaluationCase;
      output: SuggestionGenerationOutput;
    };
  }): Promise<string | null> {
    let outputText: string | null = null;
    for (
      let attempt = 1;
      attempt <= QUICK_SUGGESTION_EVALUATION_JUDGE_ATTEMPTS;
      attempt += 1
    ) {
      outputText = extractOutputText(await this.requestOpenAiJudgement(input));
      if (outputText) break;
    }
    return outputText;
  }

  private async requestOpenAiJudgement(input: {
    apiKey: string;
    model: string;
    input: {
      evaluationCase: TodaysSuggestionEvaluationCase;
      output: SuggestionGenerationOutput;
    };
  }): Promise<OpenAiResponsePayload> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        store: false,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'You are a strict evaluator for Ritora Quick Suggestion, an on-demand right-now skincare answer.',
                  'Score only the supplied synthetic on-demand case and output; do not judge it as a full daily routine.',
                  'Passing requires practical immediate advice, exact active-shelf product ownership, product preferredTime/daypart compliance, safety handling, and clear wording.',
                  'Use ownedProducts productId, brand, name, and fullName fields as the only source of truth for whether a product name is owned.',
                  'PreferredTime policy: preferredTime=morning is valid in morning or noon dayparts, preferredTime=evening is valid only in evening, and preferredTime=either is valid in any daypart.',
                  'Plain skipped history means the user did not apply a product; it must not count as an avoid/safety reason unless the supplied case shows reaction, intolerance, or a skippedCandidates safety reason.',
                  'Skipped/explanation copy may reference owned products from the supplied case by brand/name; fail only when the named product is not in the supplied ownedProducts or output steps.',
                  'A zero-step output can pass when it clearly says no extra product is needed now, the user is already covered or comfortable, or no owned product fits the current timing/safety constraints.',
                  'Fail outputs that invent products, use off-shelf products, apply a product outside preferredTime, add optional shopping pressure, or add a routine step merely to avoid an empty result.',
                  'Never require invented products, optional gaps, or an application step when no owned product fits the request.',
                  'Return JSON only.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify(
                  sanitizeForReport({
                    case: quickCaseSummary(input.input.evaluationCase),
                    output: quickOutputSummary(input.input.output),
                    rubric: {
                      answersQuestion:
                        'Does this answer the on-demand right-now request?',
                      beginnerClarity:
                        'Would a skincare beginner know whether to apply something, skip, or review a gap?',
                      personalization:
                        'Does it use the supplied request, shelf, profile, history, and safety context?',
                      gapQuality:
                        'If no product is needed, does it avoid unnecessary shopping pressure? If a gap is needed, is it essential and clear?',
                      safetyConfidence:
                        'Does it avoid unsafe actives, invented products, medical claims, and preferred-time violations?',
                    },
                    scoring:
                      'Use 0-5 integers. Set passed=false if any dimension is below 4 or a serious safety or ownership issue exists.',
                  }),
                ),
              },
            ],
          },
        ],
        max_output_tokens: Math.min(
          SUGGESTION_AI_MAX_OUTPUT_TOKENS,
          QUICK_SUGGESTION_EVALUATION_JUDGE_MAX_OUTPUT_TOKENS,
        ),
        ...openAiRepeatabilityRequestOptions(
          input.model,
          OPENAI_QUICK_SUGGESTION_REASONING_EFFORT,
        ),
        text: {
          verbosity: 'low',
          format: QUICK_JUDGE_RESPONSE_FORMAT,
        },
      }),
      signal: AbortSignal.timeout(SUGGESTION_AI_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI quick suggestion evaluation judge failed (${response.status}).`,
      );
    }

    return (await response.json()) as OpenAiResponsePayload;
  }
}

export function createLiveQuickSuggestionEvaluationRunner(
  config: ConfigService,
) {
  const model =
    readFeatureOpenAiModel(
      config,
      SUGGESTION_AI_MODEL_ENV_KEY,
      'gpt-4.1-mini',
    ) ?? 'gpt-4.1-mini';
  return {
    model,
    promptVersion: SUGGESTION_PROMPT_VERSION,
    generator: new SuggestionAiGenerator(config),
    judge: new OpenAiQuickSuggestionEvaluationJudge(config),
  };
}

async function evaluateQuickSuggestionCase(input: {
  evaluationCase: TodaysSuggestionEvaluationCase;
  generator: QuickSuggestionEvaluationGenerator;
  judge: QuickSuggestionEvaluationJudge;
  model: string;
  promptVersion: string;
  generatedAt: string;
  repeatabilityRuns: number;
}): Promise<QuickSuggestionCaseResult> {
  try {
    const output = await input.generator.generate(input.evaluationCase.inputs);
    const hardChecks = runQuickSuggestionHardChecks(
      input.evaluationCase,
      output,
    );
    let rubric: TodaysSuggestionRubricResult | null = null;
    let judgeFailure: TodaysSuggestionHardCheckResult | null = null;
    try {
      rubric = await input.judge.judge({
        evaluationCase: input.evaluationCase,
        output,
      });
    } catch (error) {
      judgeFailure = makeCheck('quick_ai_judge_execution', [
        error instanceof Error ? error.message : 'AI judge failed.',
      ]);
    }
    const repeatabilityFailures = await countRepeatabilityFailures(input);
    const repeatabilityFailure =
      repeatabilityFailures > 0
        ? makeCheck('quick_repeatability_hard_checks', [
            `${repeatabilityFailures} repeated run(s) failed quick suggestion hard checks.`,
          ])
        : null;
    const allHardChecks = [
      ...hardChecks,
      ...(judgeFailure ? [judgeFailure] : []),
      ...(repeatabilityFailure ? [repeatabilityFailure] : []),
    ];
    const hardCheckFailures = allHardChecks.filter((check) => !check.passed);
    const passed = hardCheckFailures.length === 0 && Boolean(rubric?.passed);
    return sanitizeForReport({
      caseId: input.evaluationCase.id,
      title: input.evaluationCase.title,
      status: passed ? 'passed' : 'failed',
      hardChecksPassed: allHardChecks.length - hardCheckFailures.length,
      hardChecksTotal: allHardChecks.length,
      hardCheckFailures,
      rubric,
      model: output.metadata.model || input.model,
      promptVersion: output.metadata.promptVersion || input.promptVersion,
      provider: output.metadata.provider ?? null,
      fallbackUsed: output.metadata.provider === 'deterministic_baseline',
      fallbackReason: output.metadata.fallbackReason ?? null,
      driftHash: quickDriftHash(input.evaluationCase, output, allHardChecks),
      generatedAt: input.generatedAt,
      sanitizedCaseSummary: quickCaseSummary(input.evaluationCase),
      sanitizedOutputSummary: quickOutputSummary(output),
    });
  } catch (error) {
    const hardCheckFailures = [
      makeCheck('quick_generation_execution', [
        error instanceof Error
          ? error.message
          : 'Quick suggestion generation failed.',
      ]),
    ];
    return sanitizeForReport({
      caseId: input.evaluationCase.id,
      title: input.evaluationCase.title,
      status: 'failed',
      hardChecksPassed: 0,
      hardChecksTotal: hardCheckFailures.length,
      hardCheckFailures,
      rubric: null,
      model: input.model,
      promptVersion: input.promptVersion,
      provider: null,
      fallbackUsed: false,
      fallbackReason: null,
      driftHash: createHash('sha256')
        .update(`${input.evaluationCase.id}:quick_generation_execution`)
        .digest('hex'),
      generatedAt: input.generatedAt,
      sanitizedCaseSummary: quickCaseSummary(input.evaluationCase),
      sanitizedOutputSummary: null,
    });
  }
}

async function countRepeatabilityFailures(input: {
  evaluationCase: TodaysSuggestionEvaluationCase;
  generator: QuickSuggestionEvaluationGenerator;
  repeatabilityRuns: number;
}): Promise<number> {
  let failures = 0;
  for (let run = 2; run <= input.repeatabilityRuns; run += 1) {
    try {
      const output = await input.generator.generate(
        input.evaluationCase.inputs,
      );
      if (
        runQuickSuggestionHardChecks(input.evaluationCase, output).some(
          (check) => !check.passed,
        )
      ) {
        failures += 1;
      }
    } catch {
      failures += 1;
    }
  }
  return failures;
}

function checkQuickNoStepOutcome(
  evaluationCase: TodaysSuggestionEvaluationCase,
  output: SuggestionGenerationOutput,
): TodaysSuggestionHardCheckResult {
  const failures: string[] = [];
  if (
    evaluationCase.inputs.requestSource !== SuggestionRequestSource.OnDemand
  ) {
    failures.push('Quick Suggestion evaluation case must be on-demand.');
  }
  if (
    evaluationCase.expected.maxStepCount === 0 &&
    !evaluationCase.expected.requiresGapRecommendation &&
    output.gapRecommendations.length > 0
  ) {
    failures.push(
      'No-extra-step quick case should not add gap recommendations or shopping pressure.',
    );
  }
  if (output.steps.length === 0 && output.gapRecommendations.length === 0) {
    const text = [output.explanation.headline, ...output.explanation.body].join(
      ' ',
    );
    if (
      !/\b(no|nothing|not need|no extra|skip|comfortable|unnecessary|enough)\b/i.test(
        text,
      )
    ) {
      failures.push(
        'Zero-step output needs clear user-facing copy that no extra product is needed now.',
      );
    }
  }
  return {
    id: 'quick_no_step_outcome',
    title: 'Zero-step Quick Suggestions are explicit and reassuring.',
    passed: failures.length === 0,
    failures,
  };
}

function makeCheck(
  id: string,
  failures: readonly string[],
): TodaysSuggestionHardCheckResult {
  return {
    id,
    title: id.replace(/_/g, ' '),
    passed: failures.length === 0,
    failures: [...failures],
  };
}

function normalizeRubric(value: unknown): TodaysSuggestionRubricResult {
  const candidate = value as Partial<TodaysSuggestionRubricResult>;
  return {
    answersQuestion: normalizeScore(candidate.answersQuestion),
    beginnerClarity: normalizeScore(candidate.beginnerClarity),
    personalization: normalizeScore(candidate.personalization),
    gapQuality: normalizeScore(candidate.gapQuality),
    safetyConfidence: normalizeScore(candidate.safetyConfidence),
    passed: Boolean(candidate.passed),
    explanations: Array.isArray(candidate.explanations)
      ? candidate.explanations.map((item) => String(item))
      : [],
  };
}

function normalizeScore(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(5, Math.round(value)))
    : 0;
}

function quickCaseSummary(
  evaluationCase: TodaysSuggestionEvaluationCase,
): unknown {
  const shelfProductsById = new Map(
    evaluationCase.inputs.shelfActiveProducts.map((product) => [
      product.id,
      {
        brand: product.brand,
        name: product.name,
        fullName: [product.brand, product.name].filter(Boolean).join(' '),
      },
    ]),
  );
  return sanitizeForReport({
    id: evaluationCase.id,
    title: evaluationCase.title,
    riskFocus: evaluationCase.riskFocus,
    manualReviewChecklist: evaluationCase.manualReviewChecklist,
    request: {
      source: evaluationCase.inputs.requestSource,
      intent: evaluationCase.inputs.requestContext?.intent ?? null,
      intensity: evaluationCase.inputs.requestContext?.intensity ?? null,
      note: evaluationCase.inputs.requestContext?.note ?? null,
      daypart: evaluationCase.inputs.daypart,
      targetTime: evaluationCase.inputs.targetTime,
    },
    expectations: evaluationCase.expected,
    ownedProducts: evaluationCase.inputs.contextSummary.productScores.map(
      (score) => {
        const shelfProduct = shelfProductsById.get(score.productId);
        return {
          productId: score.productId,
          brand: shelfProduct?.brand ?? null,
          name: shelfProduct?.name ?? null,
          fullName: shelfProduct?.fullName ?? null,
          category: score.category,
          preferredTimeOfDay: score.preferredTimeOfDay,
          activeTags: score.activeTags,
          suitabilityScore: score.suitabilityScore,
          cautionReasons: score.cautionReasons,
          dataQuality: score.dataQuality,
        };
      },
    ),
    skinProfile: evaluationCase.inputs.contextSummary.skinProfile,
    recentApplications: evaluationCase.inputs.recentApplications.map((log) => ({
      targetDate: log.target_date,
      daypart: log.daypart,
      items: (log.items ?? []).map((item) => ({
        status: item.status,
        productId:
          item.recommended_snapshot?.product_id ??
          item.inventory_product_id ??
          null,
        noteKind: classifyQuickApplicationNote(item.notes),
      })),
    })),
    routineMemory: evaluationCase.inputs.contextSummary.routineMemory
      ? {
          skippedProducts:
            evaluationCase.inputs.contextSummary.routineMemory.skippedProducts,
          skippedProductsRule:
            'Skipped count alone means not applied, not avoid. Only reaction/intolerance notes or skippedCandidates are safety reasons.',
        }
      : null,
    skippedCandidates: evaluationCase.inputs.contextSummary.skippedCandidates,
    safetyConstraints: evaluationCase.inputs.contextSummary.safetyConstraints,
  });
}

function classifyQuickApplicationNote(note: string | null | undefined): string {
  if (!note) return 'none';
  return isReactionRelatedSkipReason(note)
    ? 'reaction_or_intolerance'
    : 'plain_non_reaction';
}

function quickOutputSummary(output: SuggestionGenerationOutput): unknown {
  return sanitizeForReport({
    mode: output.mode,
    provider: output.metadata.provider ?? null,
    fallbackReason: output.metadata.fallbackReason ?? null,
    metadata: {
      model: output.metadata.model,
      promptVersion: output.metadata.promptVersion,
      inputTokens: output.metadata.inputTokens,
      outputTokens: output.metadata.outputTokens,
      totalTokens: output.metadata.totalTokens,
      estimatedCostUsd: output.metadata.estimatedCostUsd,
      durationMs: output.metadata.durationMs,
    },
    explanation: output.explanation,
    stepCount: output.steps.length,
    steps: output.steps.map((step) => ({
      stepOrder: step.stepOrder,
      productId: step.inventoryProductId,
      productName: step.productName,
      provenance: step.provenance,
      explanation: step.explanation,
      safetyWarnings: step.safetyWarnings,
    })),
    gapRecommendations: output.gapRecommendations,
    safetyFlags: output.safetyFlags,
  });
}

function quickDriftHash(
  evaluationCase: TodaysSuggestionEvaluationCase,
  output: SuggestionGenerationOutput,
  hardChecks: readonly TodaysSuggestionHardCheckResult[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        sanitizeForReport({
          caseId: evaluationCase.id,
          mode: output.mode,
          provider: output.metadata.provider ?? null,
          fallbackReason: output.metadata.fallbackReason ?? null,
          steps: output.steps.map((step) => ({
            order: step.stepOrder,
            productId: step.inventoryProductId,
            provenance: step.provenance,
          })),
          gaps: output.gapRecommendations.map((gap) => ({
            category: gap.ingredientOrCategory,
            sourceIds: gap.sourceIds,
          })),
          hardChecks: hardChecks.map((check) => ({
            id: check.id,
            passed: check.passed,
            failures: check.failures,
          })),
        }),
      ),
    )
    .digest('hex');
}
