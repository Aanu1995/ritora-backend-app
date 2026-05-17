import { buildDeterministicInsights } from '../../skin-journal-insight-detectors';
import type { InsightKind } from '../../skin-journal.constants';
import type { InsightCandidate } from '../insight-types';
import {
  REQUIRED_SKIN_JOURNAL_INSIGHT_EVALUATION_CASES,
  SKIN_JOURNAL_INSIGHT_EVALUATION_FIXTURES,
  SKIN_JOURNAL_INSIGHT_EVALUATION_MIN_PASS_RATE,
  type SkinJournalInsightEvaluationFixture,
} from './skin-journal-insight-evaluation.fixtures';
import {
  SKIN_JOURNAL_INSIGHT_CLINICAL_LEGAL_REVIEW,
  type ClinicalLegalReviewStatus,
} from './skin-journal-insight-launch-readiness';

const CORRELATIVE_INSIGHT_KINDS = new Set<InsightKind>([
  'correlation',
  'effectiveness',
  'routine_adherence',
]);

const UNSAFE_CLINICAL_COPY =
  /\b(causes?|caused|diagnose|diagnosis|cure|prescribe|guarantees?|clinically proven)\b/i;

export interface InsightEvaluationCheck {
  code: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface InsightEvaluationCaseResult {
  fixture_id: string;
  passed: boolean;
  produced_kinds: InsightKind[];
  checks: InsightEvaluationCheck[];
}

export interface InsightCopyReviewResult {
  passed: boolean;
  unsafe_fixture_ids: string[];
  missing_correlation_disclaimer_fixture_ids: string[];
}

export interface SkinJournalInsightEvaluationReport {
  generated_at: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  gate: {
    min_pass_rate: number;
    pass_rate: number;
    passed: boolean;
    missing_required_cases: string[];
  };
  copy_review: InsightCopyReviewResult;
  launch_readiness: {
    broad_public_launch_ready: boolean;
    clinical_legal_review: ClinicalLegalReviewStatus;
    blockers: string[];
  };
  results: InsightEvaluationCaseResult[];
}

export function buildSkinJournalInsightEvaluationReport(params: {
  generatedAt?: Date;
  requireBroadLaunchClinicalReview?: boolean;
}): SkinJournalInsightEvaluationReport {
  const generatedAt = params.generatedAt ?? new Date();
  const results = SKIN_JOURNAL_INSIGHT_EVALUATION_FIXTURES.map((fixture) =>
    evaluateInsightFixture(fixture, generatedAt),
  );
  const passedCases = results.filter((result) => result.passed).length;
  const passRate =
    results.length > 0 ? Number((passedCases / results.length).toFixed(4)) : 0;
  const resultIds = new Set(results.map((result) => result.fixture_id));
  const missingRequiredCases =
    REQUIRED_SKIN_JOURNAL_INSIGHT_EVALUATION_CASES.filter(
      (caseId) => !resultIds.has(caseId),
    );
  const copyReview = buildCopyReview(results);
  const launchReadiness = buildLaunchReadiness();
  const qualityGatePassed =
    missingRequiredCases.length === 0 &&
    passRate >= SKIN_JOURNAL_INSIGHT_EVALUATION_MIN_PASS_RATE &&
    copyReview.passed;
  const launchGatePassed =
    !params.requireBroadLaunchClinicalReview ||
    launchReadiness.broad_public_launch_ready;

  return {
    generated_at: generatedAt.toISOString(),
    total_cases: results.length,
    passed_cases: passedCases,
    failed_cases: results.length - passedCases,
    gate: {
      min_pass_rate: SKIN_JOURNAL_INSIGHT_EVALUATION_MIN_PASS_RATE,
      pass_rate: passRate,
      passed: qualityGatePassed && launchGatePassed,
      missing_required_cases: missingRequiredCases,
    },
    copy_review: copyReview,
    launch_readiness: launchReadiness,
    results,
  };
}

export function containsUnsafeClinicalInsightCopy(text: string): boolean {
  return UNSAFE_CLINICAL_COPY.test(text);
}

function evaluateInsightFixture(
  fixture: SkinJournalInsightEvaluationFixture,
  generatedAt: Date,
): InsightEvaluationCaseResult {
  const candidates = buildDeterministicInsights(
    [...fixture.entries].reverse(),
    {
      generatedAt,
      routineApplications: fixture.routineApplications ?? [],
      aiSummaryEnabled: false,
      aiPatternEnabled: false,
    },
  );
  const producedKinds = candidates.map((candidate) => candidate.kind);
  const checks: InsightEvaluationCheck[] = [
    expectedKindsCheck(fixture.expectedKinds, producedKinds),
    forbiddenKindsCheck(fixture.forbiddenKinds ?? [], producedKinds),
    clinicalCopyCheck(candidates),
    correlationDisclaimerCheck(candidates),
  ];

  return {
    fixture_id: fixture.id,
    passed: checks.every((check) => check.passed),
    produced_kinds: producedKinds,
    checks,
  };
}

function expectedKindsCheck(
  expectedKinds: InsightKind[],
  producedKinds: InsightKind[],
): InsightEvaluationCheck {
  const missing = expectedKinds.filter((kind) => !producedKinds.includes(kind));
  return {
    code: 'expected_insight_kinds_present',
    passed: missing.length === 0,
    expected: expectedKinds,
    actual: producedKinds,
  };
}

function forbiddenKindsCheck(
  forbiddenKinds: InsightKind[],
  producedKinds: InsightKind[],
): InsightEvaluationCheck {
  const present = forbiddenKinds.filter((kind) => producedKinds.includes(kind));
  return {
    code: 'forbidden_insight_kinds_absent',
    passed: present.length === 0,
    expected: forbiddenKinds,
    actual: present,
  };
}

function clinicalCopyCheck(
  candidates: InsightCandidate[],
): InsightEvaluationCheck {
  const unsafe = candidates.filter((candidate) =>
    containsUnsafeClinicalInsightCopy(candidateInlineCopy(candidate)),
  );
  return {
    code: 'clinical_copy_guard',
    passed: unsafe.length === 0,
    expected: [],
    actual: unsafe.map((candidate) => candidate.kind),
  };
}

function correlationDisclaimerCheck(
  candidates: InsightCandidate[],
): InsightEvaluationCheck {
  const missing = candidates.filter(
    (candidate) =>
      CORRELATIVE_INSIGHT_KINDS.has(candidate.kind) &&
      !candidate.blocks.some((block) => block.type === 'disclaimer'),
  );
  return {
    code: 'correlative_insights_have_disclaimer',
    passed: missing.length === 0,
    expected: [],
    actual: missing.map((candidate) => candidate.kind),
  };
}

function buildCopyReview(
  results: InsightEvaluationCaseResult[],
): InsightCopyReviewResult {
  const unsafeFixtureIds = results
    .filter((result) =>
      result.checks.some(
        (check) => check.code === 'clinical_copy_guard' && !check.passed,
      ),
    )
    .map((result) => result.fixture_id);
  const missingCorrelationDisclaimerFixtureIds = results
    .filter((result) =>
      result.checks.some(
        (check) =>
          check.code === 'correlative_insights_have_disclaimer' &&
          !check.passed,
      ),
    )
    .map((result) => result.fixture_id);

  return {
    passed:
      unsafeFixtureIds.length === 0 &&
      missingCorrelationDisclaimerFixtureIds.length === 0,
    unsafe_fixture_ids: unsafeFixtureIds,
    missing_correlation_disclaimer_fixture_ids:
      missingCorrelationDisclaimerFixtureIds,
  };
}

function buildLaunchReadiness(): SkinJournalInsightEvaluationReport['launch_readiness'] {
  const blockers: string[] = [];
  if (!SKIN_JOURNAL_INSIGHT_CLINICAL_LEGAL_REVIEW.approved) {
    blockers.push('clinical_legal_review_not_approved');
  }

  return {
    broad_public_launch_ready: blockers.length === 0,
    clinical_legal_review: SKIN_JOURNAL_INSIGHT_CLINICAL_LEGAL_REVIEW,
    blockers,
  };
}

function candidateInlineCopy(candidate: InsightCandidate): string {
  const blockText = candidate.blocks
    .map((block) =>
      'text' in block && typeof block.text === 'string' ? block.text : '',
    )
    .join(' ');
  return [candidate.headline.text, blockText].filter(Boolean).join(' ');
}
