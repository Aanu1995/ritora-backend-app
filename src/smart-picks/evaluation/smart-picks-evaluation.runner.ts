import { createHash } from 'crypto';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { User } from '../../users/entities/user.entity';
import {
  GeneratedSmartPick,
  SmartPicksAiGenerationResult,
  SmartPicksAiPlanGenerationResult,
  SmartPicksAiPlanResult,
} from '../services/smart-picks-ai-generator';
import { SmartPicksContext } from '../services/smart-picks-context-builder';
import {
  SmartPicksGapSnapshot,
  SmartPicksProductAdherence,
} from '../smart-picks.types';
import {
  GoldenSmartPicksPersona,
  GoldenSmartPicksProduct,
  SMART_PICKS_GOLDEN_PERSONAS,
} from './smart-picks-golden-personas';

const SMART_PICKS_EVALUATION_PRODUCT_PICK_BATCH_SIZE = 1;

export type SmartPicksEvaluationStatus = 'passed' | 'review' | 'failed';

export interface SmartPicksEvaluationGenerator {
  generatePlanWithDiagnostics(
    context: SmartPicksContext,
  ): Promise<SmartPicksAiPlanGenerationResult>;
  generateWithDiagnostics(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
  ): Promise<SmartPicksAiGenerationResult>;
}

export interface SmartPicksEvaluationCheck {
  id: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface SmartPicksEvaluationProductSummary {
  normalizedKey: string;
  brand: string;
  productName: string;
  budgetTier: string | null;
  sellerNameCount: number;
  alternativeCount: number;
  recommendationRankReason: string | null;
}

export interface SmartPicksEvaluationCaseResult {
  id: string;
  mode: string;
  countryCode: string;
  budgetTier: string;
  primaryGoal: string;
  status: SmartPicksEvaluationStatus;
  score: number;
  checks: SmartPicksEvaluationCheck[];
  planDiagnostics: SmartPicksAiPlanGenerationResult['diagnostics'];
  productDiagnostics: SmartPicksAiGenerationResult['diagnostics'] | null;
  coverageRoles: string[];
  priorityGapKeys: string[];
  considerGapKeys: string[];
  productPicks: SmartPicksEvaluationProductSummary[];
  manualReviewChecklist: readonly string[];
}

export interface SmartPicksEvaluationReport {
  generatedAt: string;
  model: string;
  promptVersion: string;
  totalCases: number;
  passedCases: number;
  reviewCases: number;
  failedCases: number;
  gate: {
    passed: boolean;
    blockers: string[];
  };
  driftHash: string;
  cases: SmartPicksEvaluationCaseResult[];
}

export async function evaluateSmartPicksGoldenPersonas(input: {
  generator: SmartPicksEvaluationGenerator;
  model: string;
  promptVersion: string;
  personas?: readonly GoldenSmartPicksPersona[];
  includeProductPicks?: boolean;
  generatedAt?: Date;
  onProgress?: (event: {
    phase: 'started' | 'completed';
    index: number;
    total: number;
    personaId: string;
    status?: SmartPicksEvaluationStatus;
    score?: number;
  }) => void;
}): Promise<SmartPicksEvaluationReport> {
  const personas = input.personas ?? SMART_PICKS_GOLDEN_PERSONAS;
  const results: SmartPicksEvaluationCaseResult[] = [];
  for (let index = 0; index < personas.length; index += 1) {
    const persona = personas[index];
    input.onProgress?.({
      phase: 'started',
      index: index + 1,
      total: personas.length,
      personaId: persona.id,
    });
    const result = await evaluateSmartPicksPersona({
      persona,
      generator: input.generator,
      includeProductPicks: input.includeProductPicks ?? true,
    });
    input.onProgress?.({
      phase: 'completed',
      index: index + 1,
      total: personas.length,
      personaId: persona.id,
      status: result.status,
      score: result.score,
    });
    results.push(result);
  }
  return buildSmartPicksEvaluationReport({
    model: input.model,
    promptVersion: input.promptVersion,
    generatedAt: input.generatedAt ?? new Date(),
    results,
  });
}

export async function evaluateSmartPicksPersona(input: {
  persona: GoldenSmartPicksPersona;
  generator: SmartPicksEvaluationGenerator;
  includeProductPicks?: boolean;
}): Promise<SmartPicksEvaluationCaseResult> {
  const context = buildGoldenSmartPicksContext(input.persona);
  const planResult = await input.generator.generatePlanWithDiagnostics(context);
  const checks: SmartPicksEvaluationCheck[] = [];
  const plan = planResult.plan;

  if (!plan) {
    checks.push(check('plan_exists', true, false, 'AI returned a usable plan'));
    return caseResult(input.persona, checks, planResult, null, null, []);
  }

  checks.push(
    checkCoverageRoleCoverage(
      'coverage_roles',
      input.persona.expected.coverageRoles,
      plan.coverage.slots.map((slot) => slot.role),
      'Coverage roles match the persona expectation',
    ),
    checkConceptCoverage(
      'priority_gaps',
      input.persona.expected.priorityGapKeys,
      plan.priorityGaps.map((gap) => gap.normalizedKey),
      'Priority gap concepts match the persona expectation',
    ),
    checkConceptCoverage(
      'consider_gaps',
      input.persona.expected.considerGapKeys,
      [...plan.considerGaps, ...plan.priorityGaps].map(
        (gap) => gap.normalizedKey,
      ),
      'Worth-considering gap concepts match the persona expectation',
    ),
    checkMinimumCount(
      'minimum_consider_gap_count',
      minimumConsiderGapCount(input.persona),
      plan.considerGaps.length,
      'Worth-considering gap count meets the persona minimum',
    ),
    checkMaximumCount(
      'blocked_safety_count',
      input.persona.expected.blockedSafetyGapCount,
      planResult.diagnostics.blockedSafetyGapCount,
      'Safety-blocked gap count does not exceed the persona expectation',
    ),
    checkMaximumCount(
      'blocked_pregnancy_safety_count',
      input.persona.expected.blockedPregnancySafetyGapCount,
      planResult.diagnostics.blockedPregnancySafetyGapCount,
      'Pregnancy safety-blocked gap count does not exceed the persona expectation',
    ),
    checkGuardrailDiagnosticCount(
      'blocked_replacement_evidence_count',
      planResult.diagnostics.blockedReplacementEvidenceGapCount,
      'Replacement evidence guardrail blocked unbacked replacement attempts',
    ),
  );

  const productGaps = [...plan.priorityGaps, ...plan.considerGaps];
  const productResult =
    input.includeProductPicks === false
      ? null
      : await generateEvaluationProductPicksWithRetry(
          input.generator,
          context,
          productGaps,
        );
  const productPicks = productResult
    ? summarizeProductPicks(productResult.picks)
    : [];
  if (productResult && productGaps.length > 0) {
    checks.push(
      check(
        'accepted_product_pick_count',
        productGaps.length,
        productResult.diagnostics.acceptedPickCount,
        'Product-pick count matches generated gaps',
      ),
      checkConceptCoverage(
        'product_pick_keys',
        [
          ...input.persona.expected.priorityGapKeys,
          ...input.persona.expected.considerGapKeys,
        ],
        [...productResult.picks.keys()],
        'Product picks exist for every expected gap concept',
      ),
    );
  }

  return caseResult(
    input.persona,
    checks,
    planResult,
    productResult,
    plan,
    productPicks,
  );
}

function minimumConsiderGapCount(persona: GoldenSmartPicksPersona): number {
  return (
    persona.expected.minimumConsiderGapCount ??
    persona.expected.considerGapKeys.length
  );
}

async function generateEvaluationProductPicksWithRetry(
  generator: SmartPicksEvaluationGenerator,
  context: SmartPicksContext,
  gaps: SmartPicksGapSnapshot[],
): Promise<SmartPicksAiGenerationResult> {
  if (gaps.length === 0) {
    return generator.generateWithDiagnostics(context, gaps);
  }

  const mergedPicks = new Map<string, GeneratedSmartPick>();
  let combinedDiagnostics: SmartPicksAiGenerationResult['diagnostics'] | null =
    null;
  for (const batch of chunkEvaluationGaps(
    gaps,
    SMART_PICKS_EVALUATION_PRODUCT_PICK_BATCH_SIZE,
  )) {
    const batchResult = await generateEvaluationProductPickBatchWithRetry(
      generator,
      context,
      batch,
    );
    for (const [key, pick] of batchResult.picks) {
      mergedPicks.set(key, pick);
    }
    combinedDiagnostics = combineEvaluationProductDiagnostics(
      gaps.length,
      mergedPicks.size,
      combinedDiagnostics,
      batchResult.diagnostics,
    );
  }

  return {
    picks: mergedPicks,
    diagnostics:
      combinedDiagnostics ??
      emptyEvaluationProductDiagnostics(gaps.length, mergedPicks.size),
  };
}

async function generateEvaluationProductPickBatchWithRetry(
  generator: SmartPicksEvaluationGenerator,
  context: SmartPicksContext,
  gaps: SmartPicksGapSnapshot[],
): Promise<SmartPicksAiGenerationResult> {
  const firstResult = await generator.generateWithDiagnostics(context, gaps);
  if (firstResult.diagnostics.providerFailed) return firstResult;
  const missingGaps = gaps.filter(
    (gap) => !firstResult.picks.has(gap.normalizedKey),
  );
  if (missingGaps.length === 0) return firstResult;

  const retryResult = await generator.generateWithDiagnostics(
    context,
    missingGaps,
  );
  const mergedPicks = new Map(firstResult.picks);
  for (const [key, pick] of retryResult.picks) {
    mergedPicks.set(key, pick);
  }
  return {
    picks: mergedPicks,
    diagnostics: {
      requestedGapCount: gaps.length,
      rawGapCount:
        firstResult.diagnostics.rawGapCount +
        retryResult.diagnostics.rawGapCount,
      acceptedPickCount: mergedPicks.size,
      blockedOwnedCount:
        firstResult.diagnostics.blockedOwnedCount +
        retryResult.diagnostics.blockedOwnedCount,
      blockedBudgetCount:
        firstResult.diagnostics.blockedBudgetCount +
        retryResult.diagnostics.blockedBudgetCount,
      blockedSafetyCount:
        firstResult.diagnostics.blockedSafetyCount +
        retryResult.diagnostics.blockedSafetyCount,
      invalidPickCount:
        firstResult.diagnostics.invalidPickCount +
        retryResult.diagnostics.invalidPickCount,
      missingPickCount: Math.max(0, gaps.length - mergedPicks.size),
      providerFailed: retryResult.diagnostics.providerFailed,
      providerSkippedReason:
        retryResult.diagnostics.providerSkippedReason ??
        firstResult.diagnostics.providerSkippedReason,
      model: firstResult.diagnostics.model ?? retryResult.diagnostics.model,
      inputTokens: nullableSum(
        firstResult.diagnostics.inputTokens,
        retryResult.diagnostics.inputTokens,
      ),
      outputTokens: nullableSum(
        firstResult.diagnostics.outputTokens,
        retryResult.diagnostics.outputTokens,
      ),
      totalTokens: nullableSum(
        firstResult.diagnostics.totalTokens,
        retryResult.diagnostics.totalTokens,
      ),
      estimatedCostUsd: nullableSum(
        firstResult.diagnostics.estimatedCostUsd,
        retryResult.diagnostics.estimatedCostUsd,
      ),
    },
  };
}

function combineEvaluationProductDiagnostics(
  requestedGapCount: number,
  acceptedPickCount: number,
  previous: SmartPicksAiGenerationResult['diagnostics'] | null,
  next: SmartPicksAiGenerationResult['diagnostics'],
): SmartPicksAiGenerationResult['diagnostics'] {
  if (!previous) {
    return {
      ...next,
      requestedGapCount,
      acceptedPickCount,
      missingPickCount: Math.max(0, requestedGapCount - acceptedPickCount),
    };
  }

  return {
    requestedGapCount,
    rawGapCount: previous.rawGapCount + next.rawGapCount,
    acceptedPickCount,
    blockedOwnedCount: previous.blockedOwnedCount + next.blockedOwnedCount,
    blockedBudgetCount: previous.blockedBudgetCount + next.blockedBudgetCount,
    blockedSafetyCount: previous.blockedSafetyCount + next.blockedSafetyCount,
    invalidPickCount: previous.invalidPickCount + next.invalidPickCount,
    missingPickCount: Math.max(0, requestedGapCount - acceptedPickCount),
    providerFailed: previous.providerFailed || next.providerFailed,
    providerSkippedReason:
      next.providerSkippedReason ?? previous.providerSkippedReason,
    model: previous.model ?? next.model,
    inputTokens: nullableSum(previous.inputTokens, next.inputTokens),
    outputTokens: nullableSum(previous.outputTokens, next.outputTokens),
    totalTokens: nullableSum(previous.totalTokens, next.totalTokens),
    estimatedCostUsd: nullableSum(
      previous.estimatedCostUsd,
      next.estimatedCostUsd,
    ),
  };
}

function emptyEvaluationProductDiagnostics(
  requestedGapCount: number,
  acceptedPickCount: number,
): SmartPicksAiGenerationResult['diagnostics'] {
  return {
    requestedGapCount,
    rawGapCount: 0,
    acceptedPickCount,
    blockedOwnedCount: 0,
    blockedBudgetCount: 0,
    blockedSafetyCount: 0,
    invalidPickCount: 0,
    missingPickCount: Math.max(0, requestedGapCount - acceptedPickCount),
    providerFailed: false,
    providerSkippedReason: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCostUsd: null,
  };
}

function chunkEvaluationGaps(
  gaps: SmartPicksGapSnapshot[],
  batchSize: number,
): SmartPicksGapSnapshot[][] {
  const chunks: SmartPicksGapSnapshot[][] = [];
  for (let index = 0; index < gaps.length; index += batchSize) {
    chunks.push(gaps.slice(index, index + batchSize));
  }
  return chunks;
}

function nullableSum(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

export function buildSmartPicksEvaluationReport(input: {
  model: string;
  promptVersion: string;
  generatedAt: Date;
  results: SmartPicksEvaluationCaseResult[];
}): SmartPicksEvaluationReport {
  const passedCases = input.results.filter(
    (result) => result.status === 'passed',
  ).length;
  const reviewCases = input.results.filter(
    (result) => result.status === 'review',
  ).length;
  const failedCases = input.results.filter(
    (result) => result.status === 'failed',
  ).length;
  const blockers = [
    failedCases > 0
      ? `${failedCases} Smart Picks evaluation case(s) failed.`
      : null,
    reviewCases > 0
      ? `${reviewCases} Smart Picks evaluation case(s) need review.`
      : null,
  ].filter((blocker): blocker is string => Boolean(blocker));
  return {
    generatedAt: input.generatedAt.toISOString(),
    model: input.model,
    promptVersion: input.promptVersion,
    totalCases: input.results.length,
    passedCases,
    reviewCases,
    failedCases,
    gate: {
      passed: blockers.length === 0,
      blockers,
    },
    driftHash: evaluationDriftHash(input.results),
    cases: input.results,
  };
}

export function buildGoldenSmartPicksContext(
  persona: GoldenSmartPicksPersona,
): SmartPicksContext {
  const activeProducts = persona.activeProducts.map(goldenProduct);
  const allProducts =
    persona.allProducts.length > 0
      ? persona.allProducts.map(goldenProduct)
      : activeProducts;
  return {
    user: {
      id: `eval-${persona.id}`,
      time_zone: 'Europe/Stockholm',
    } as User,
    skinProfile: goldenSkinProfile(persona),
    skinProfileRequired: false,
    missingProfileFields: [],
    consentRequired: false,
    activeProducts,
    allProducts,
    environment: null,
    budgetTier: persona.budgetTier,
    mode: persona.mode,
    inputsHash: `eval-${persona.id}`,
    skinJournalSummary: persona.skinJournalSummary ?? null,
    productPerformance: persona.productPerformance.map((summary) => ({
      productId: summary.productId,
      brand: summary.brand,
      productName: summary.productName,
      category: summary.category,
      usageDaysLast30: summary.usageDaysLast30,
      usageDaysLast90: summary.usageDaysLast90,
      firstUsedAt: summary.usageDaysLast90 > 0 ? '2026-01-15' : null,
      lastUsedAt: summary.usageDaysLast90 > 0 ? '2026-05-10' : null,
      adherence:
        summary.usageDaysLast90 > 0
          ? SmartPicksProductAdherence.Consistent
          : SmartPicksProductAdherence.None,
      goalTrend: summary.goalTrend,
      concernTrend: persona.currentConcerns[0] ?? null,
      photoCheckpoints: summary.photoCheckpoints,
      reactionSignalCount: 0,
      replacementCandidate: summary.replacementCandidate,
      replacementReason: summary.replacementReason,
    })),
  };
}

function caseResult(
  persona: GoldenSmartPicksPersona,
  checks: SmartPicksEvaluationCheck[],
  planResult: SmartPicksAiPlanGenerationResult,
  productResult: SmartPicksAiGenerationResult | null,
  plan: SmartPicksAiPlanResult | null,
  productPicks: SmartPicksEvaluationProductSummary[],
): SmartPicksEvaluationCaseResult {
  const passed = checks.filter((item) => item.passed).length;
  const score = checks.length === 0 ? 0 : passed / checks.length;
  return {
    id: persona.id,
    mode: persona.mode,
    countryCode: persona.countryCode,
    budgetTier: persona.budgetTier,
    primaryGoal: persona.primaryGoal,
    status: score === 1 ? 'passed' : score >= 0.7 ? 'review' : 'failed',
    score,
    checks,
    planDiagnostics: planResult.diagnostics,
    productDiagnostics: productResult?.diagnostics ?? null,
    coverageRoles: plan?.coverage.slots.map((slot) => slot.role) ?? [],
    priorityGapKeys: plan?.priorityGaps.map((gap) => gap.normalizedKey) ?? [],
    considerGapKeys: plan?.considerGaps.map((gap) => gap.normalizedKey) ?? [],
    productPicks,
    manualReviewChecklist: persona.manualReviewChecklist,
  };
}

function check(
  id: string,
  expected: unknown,
  actual: unknown,
  label: string,
): SmartPicksEvaluationCheck {
  return {
    id,
    passed: JSON.stringify(expected) === JSON.stringify(actual),
    expected: `${label}: ${JSON.stringify(expected)}`,
    actual: JSON.stringify(actual),
  };
}

function checkMinimumCount(
  id: string,
  expectedMinimum: number,
  actual: number,
  label: string,
): SmartPicksEvaluationCheck {
  return {
    id,
    passed: actual >= expectedMinimum,
    expected: `${label}: at least ${expectedMinimum}`,
    actual: JSON.stringify(actual),
  };
}

function checkMaximumCount(
  id: string,
  expectedMaximum: number,
  actual: number,
  label: string,
): SmartPicksEvaluationCheck {
  return {
    id,
    passed: actual <= expectedMaximum,
    expected: `${label}: at most ${expectedMaximum}`,
    actual: JSON.stringify(actual),
  };
}

function checkGuardrailDiagnosticCount(
  id: string,
  actual: number,
  label: string,
): SmartPicksEvaluationCheck {
  return {
    id,
    passed: true,
    expected: `${label}: recorded for monitoring`,
    actual: JSON.stringify(actual),
  };
}

function checkCoverageRoleCoverage(
  id: string,
  expected: readonly string[],
  actual: readonly string[],
  label: string,
): SmartPicksEvaluationCheck {
  const missing = missingExpectedCoverageRoles(expected, actual);
  return {
    id,
    passed: missing.length === 0,
    expected: `${label}: ${JSON.stringify(expected)}`,
    actual: JSON.stringify({ actual: [...actual].sort(), missing }),
  };
}

function missingExpectedCoverageRoles(
  expected: readonly string[],
  actual: readonly string[],
): string[] {
  const unmatchedActual = [...actual];
  const missing: string[] = [];
  for (const expectedRole of expected) {
    const matchIndex = unmatchedActual.findIndex((actualRole) =>
      coverageRolesMatch(expectedRole, actualRole),
    );
    if (matchIndex === -1) {
      missing.push(expectedRole);
      continue;
    }
    unmatchedActual.splice(matchIndex, 1);
  }
  return missing;
}

function coverageRolesMatch(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  if (
    ['exfoliation-mask', 'texture-exfoliant', 'congestion-mask'].includes(
      expected,
    )
  ) {
    return [
      'exfoliation-mask',
      'texture-exfoliant',
      'congestion-mask',
    ].includes(actual);
  }
  if (['moisturise', 'hydrate'].includes(expected)) {
    return ['moisturise', 'barrier-support', 'hydrate'].includes(actual);
  }
  if (expected === 'barrier-support') {
    return ['barrier-support', 'moisturise', 'hydrate'].includes(actual);
  }
  if (expected === 'peptide') {
    return ['peptide', 'barrier-support', 'hydrate'].includes(actual);
  }
  if (expected === 'recovery-mask') {
    return [
      'recovery-mask',
      'barrier-support',
      'hydrate',
      'treatment-secondary',
    ].includes(actual);
  }
  if (
    ['goal-primary', 'goal-support', 'treat', 'treatment-secondary'].includes(
      expected,
    )
  ) {
    return [
      'goal-primary',
      'goal-support',
      'antioxidant',
      'barrier-support',
      'congestion-mask',
      'dark-spot-treatment',
      'exfoliation-mask',
      'acne-treatment',
      'recovery-mask',
      'texture-exfoliant',
      'retinoid',
      'peptide',
      'treat',
      'treatment-secondary',
    ].includes(actual);
  }
  return false;
}

function checkConceptCoverage(
  id: string,
  expected: readonly string[],
  actual: readonly string[],
  label: string,
): SmartPicksEvaluationCheck {
  const missing = missingExpectedConcepts(expected, actual);
  return {
    id,
    passed: missing.length === 0,
    expected: `${label}: ${JSON.stringify(expected)}`,
    actual: JSON.stringify({ actual, missing }),
  };
}

function missingExpectedConcepts(
  expected: readonly string[],
  actual: readonly string[],
): string[] {
  const unmatchedActual = [...actual];
  const missing: string[] = [];
  for (const expectedConcept of expected) {
    const matchIndex = unmatchedActual.findIndex((actualConcept) =>
      conceptsMatch(expectedConcept, actualConcept),
    );
    if (matchIndex === -1) {
      missing.push(expectedConcept);
      continue;
    }
    if (!canShareMatchedConcept(expectedConcept, unmatchedActual[matchIndex])) {
      unmatchedActual.splice(matchIndex, 1);
    }
  }
  return missing;
}

function conceptsMatch(expected: string, actual: string): boolean {
  if (normalizeConceptKey(expected) === normalizeConceptKey(actual)) {
    return true;
  }
  const expectedTokens = conceptTokens(expected);
  const actualTokens = conceptTokens(actual);
  if (expectedTokens.size === 0 || actualTokens.size === 0) return false;
  if (expectedTokens.has('replacement') && actualTokens.has('replacement')) {
    return true;
  }
  if (isAcneTreatmentConcept(expectedTokens, actualTokens)) return true;
  if (expectedTokens.has('retinoid') && actualTokens.has('retinoid')) {
    return true;
  }
  if (isPeptideSupportConcept(expectedTokens, actualTokens)) return true;
  if (isBarrierMoisturizerConcept(expectedTokens, actualTokens)) return true;
  if (expectedTokens.has('recovery') && actualTokens.has('recovery')) {
    return true;
  }
  const overlapCount = [...expectedTokens].filter((token) =>
    actualTokens.has(token),
  ).length;
  const ratio = overlapCount / expectedTokens.size;
  const minimumOverlap =
    expectedTokens.size <= 3 ? Math.min(2, expectedTokens.size) : 2;
  const strongTokenMatch = [...expectedTokens].some(
    (token) => CONCEPT_STRONG_TOKENS.has(token) && actualTokens.has(token),
  );
  return overlapCount >= minimumOverlap && (ratio >= 0.45 || strongTokenMatch);
}

function canShareMatchedConcept(expected: string, actual: string): boolean {
  const expectedTokens = conceptTokens(expected);
  const actualTokens = conceptTokens(actual);
  return (
    actualTokens.has('replacement') &&
    (expectedTokens.has('replacement') ||
      isBarrierMoisturizerConcept(expectedTokens, actualTokens))
  );
}

function isPeptideSupportConcept(
  expectedTokens: ReadonlySet<string>,
  actualTokens: ReadonlySet<string>,
): boolean {
  return (
    expectedTokens.has('peptide') &&
    (actualTokens.has('peptide') ||
      (actualTokens.has('barrier') &&
        (actualTokens.has('serum') || actualTokens.has('moisturizer'))))
  );
}

function isBarrierMoisturizerConcept(
  expectedTokens: ReadonlySet<string>,
  actualTokens: ReadonlySet<string>,
): boolean {
  return (
    expectedTokens.has('barrier') &&
    expectedTokens.has('moisturizer') &&
    actualTokens.has('barrier') &&
    actualTokens.has('moisturizer')
  );
}

function isAcneTreatmentConcept(
  expectedTokens: ReadonlySet<string>,
  actualTokens: ReadonlySet<string>,
): boolean {
  const expectedAcneTreatment =
    expectedTokens.has('acne') ||
    expectedTokens.has('adapalene') ||
    expectedTokens.has('benzoyl');
  const actualAcneTreatment =
    actualTokens.has('acne') ||
    actualTokens.has('adapalene') ||
    actualTokens.has('benzoyl') ||
    actualTokens.has('bha') ||
    actualTokens.has('salicylic');
  return expectedAcneTreatment && actualAcneTreatment;
}

const CONCEPT_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'or',
  'the',
  'to',
  'of',
  'for',
  'with',
  'without',
  'by',
  'from',
  'in',
  'on',
  'very',
  'low',
  'high',
  'checked',
  'finish',
  'lane',
  'product',
  'weekly',
  'daily',
  'eg',
  'used',
  'sparingly',
]);

const CONCEPT_STRONG_TOKENS = new Set([
  'adapalene',
  'aha',
  'antioxidant',
  'azelaic',
  'benzoyl',
  'bha',
  'ceramide',
  'cleanser',
  'glycerin',
  'moisturizer',
  'niacinamide',
  'panthenol',
  'peel',
  'peptide',
  'recovery',
  'retinoid',
  'serum',
  'spf',
  'sunscreen',
  'tranexamic',
  'vitamin',
  'peel',
]);

function normalizeConceptKey(value: string): string {
  return [...conceptTokens(value)].sort().join('-');
}

function conceptTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9+]+/u)
      .map(canonicalConceptToken)
      .filter((token): token is string => Boolean(token)),
  );
}

function canonicalConceptToken(token: string): string | null {
  if (!token || CONCEPT_STOP_WORDS.has(token)) return null;
  if (/^spf\d+$/u.test(token)) return 'spf';
  if (
    ['moisturise', 'moisturiser', 'moisturising', 'moisturizing'].includes(
      token,
    )
  ) {
    return 'moisturizer';
  }
  if (['cream', 'lotion'].includes(token)) return 'moisturizer';
  if (['spots', 'spot', 'marks'].includes(token)) return 'mark';
  if (['pigmentation', 'pih'].includes(token)) return 'pigment';
  if (['resurfacing', 'smoothing'].includes(token)) return 'peel';
  if (
    ['mask', 'peeling', 'exfoliant', 'exfoliation', 'exfoliating'].includes(
      token,
    )
  ) {
    return 'peel';
  }
  if (['irritation', 'irritating'].includes(token)) {
    return 'gentle';
  }
  if (['sensitive', 'sensitivity', 'fragrance'].includes(token)) {
    return 'sensitive';
  }
  if (
    [
      'allantoin',
      'balm',
      'calm',
      'calming',
      'centella',
      'cica',
      'panthenol',
      'recovery',
      'soothing',
    ].includes(token)
  ) {
    return 'recovery';
  }
  if (['supporting', 'supports', 'supported'].includes(token)) {
    return 'support';
  }
  if (['ceramides', 'ceramide', 'glycerin'].includes(token)) {
    return 'barrier';
  }
  if (['retinal', 'retinol', 'retinoids'].includes(token)) {
    return 'retinoid';
  }
  if (token.endsWith('s') && token.length > 3) return token.slice(0, -1);
  return token;
}

function summarizeProductPicks(
  picks: ReadonlyMap<string, GeneratedSmartPick>,
): SmartPicksEvaluationProductSummary[] {
  return [...picks.entries()].map(([normalizedKey, pick]) => ({
    normalizedKey,
    brand: pick.brand,
    productName: pick.productName,
    budgetTier: pick.budgetTier,
    sellerNameCount: pick.sellerNames.length,
    alternativeCount: pick.alternatives.length,
    recommendationRankReason: pick.recommendationRankReason,
  }));
}

function evaluationDriftHash(
  results: readonly SmartPicksEvaluationCaseResult[],
): string {
  const stable = results.map((result) => ({
    id: result.id,
    status: result.status,
    score: result.score,
    coverageRoles: result.coverageRoles,
    priorityGapKeys: result.priorityGapKeys,
    considerGapKeys: result.considerGapKeys,
    productPicks: result.productPicks.map((pick) => ({
      normalizedKey: pick.normalizedKey,
      brand: pick.brand,
      productName: pick.productName,
      budgetTier: pick.budgetTier,
    })),
  }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function goldenProduct(
  productFixture: GoldenSmartPicksProduct,
): InventoryProduct {
  return {
    id: productFixture.id,
    user_id: `eval-user`,
    brand: productFixture.brand,
    name: productFixture.name,
    category: productFixture.category,
    barcode: null,
    status: productFixture.status,
    provenance: 'photo-lookup',
    brand_search: productFixture.brand.toLowerCase(),
    name_search: productFixture.name.toLowerCase(),
    search_document: `${productFixture.brand} ${productFixture.name}`,
    opened_at: null,
    expires_at: null,
    period_after_opening_months: null,
    effective_expires_at: null,
    identity: {
      brand: productFixture.brand,
      name: productFixture.name,
      category: productFixture.category,
      barcode: null,
      imageUrls: [],
      sizeMl: null,
      description: null,
      benefits: [...productFixture.benefits],
      suitedFor: [],
      inciIngredients: [...productFixture.ingredients],
      inciLastConfirmedAt: null,
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    manufacturer: {
      brand: productFixture.brand,
      parentCompany: null,
      countryOfOrigin: null,
      countryOfManufacture: null,
      supportEmail: null,
      productUrl: null,
      websiteUrl: null,
    },
    user_fields: {
      openedAt: null,
      expiresAt: null,
      periodAfterOpeningMonths: null,
      pricePaid: null,
      pricePaidCurrency: null,
      purchasedFrom: null,
      personalNotes: null,
      preferredTimeOfDay: null,
    },
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
  } as unknown as InventoryProduct;
}

function goldenSkinProfile(persona: GoldenSmartPicksPersona): SkinProfile {
  return {
    user_id: `eval-${persona.id}`,
    skin_type: persona.skinType,
    skin_tone: persona.skinTone,
    ethnicity: persona.ethnicity,
    current_concerns: [...persona.currentConcerns],
    country_code: persona.countryCode,
    city: persona.city,
    fitzpatrick_phototype: 'type_v',
    sensitivity_level: 'moderate',
    hydration_level: 'balanced',
    primary_goal: persona.primaryGoal,
    pregnancy_status: persona.pregnancyStatus,
    under_dermatologist_care: null,
    allow_smart_picks: true,
    budget_tier: persona.budgetTier,
    safety_context: { conditions: [], medications: [] },
    reaction_history: {
      entries: persona.reactionTriggers.map((trigger) => ({ trigger })),
    },
    concern_details: {
      per_concern: persona.currentConcerns.map((concern, index) => ({
        concern,
        severity: index === 0 ? 'moderate' : 'mild',
        priority: index + 1,
      })),
    },
    skin_behavior: {
      pih_tendency: 'yes',
      melasma_tendency: 'not_sure',
      keloid_tendency: 'not_sure',
      sunscreen_habit: 'most_days',
      sunscreen_tolerance: 'some_white_cast',
    },
    active_tolerances: persona.activeTolerances,
    routine_preferences: {
      pace: 'steady',
      fragrance_free: persona.ingredientDislikes.includes('fragrance'),
      non_comedogenic: true,
      sunscreen_filter: 'no_preference',
      sunscreen_finish: 'no_white_cast',
    },
    lifestyle_context: {
      water_hardness: 'unknown',
      water_sensitivity: 'not_sure',
      climate_sensitivities: [],
    },
    shopping_preferences: {
      ingredient_dislikes: [...persona.ingredientDislikes],
      product_dislikes: [],
      brand_dislikes: [],
    },
    hormonal_context: {},
  } as unknown as SkinProfile;
}
