import type { AnalysisObservations } from '../skin-journal.constants';
import type { AnalysisPhotoPreflightIssue } from '../services/skin-journal-analysis-preflight';
import {
  type LocalFaceGateExpectation,
  QUALITY_ISSUE_PRESENCE_OPTIONAL,
  REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES,
  SKIN_JOURNAL_ANALYSIS_EVALUATION_MIN_PASS_RATE,
  type SkinJournalAnalysisEvaluationFixture,
} from './skin-journal-analysis-evaluation.fixtures';

const LOCAL_FACE_GATE_EVALUATION_MIN_PASS_RATE = 0.98;
const LOCAL_FACE_GATE_EVALUATION_MAX_FALSE_ACCEPT_RATE = 0;

export interface AnalysisEvaluationCheck {
  code: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface AnalysisEvaluationCaseResult {
  fixture_id: string;
  passed: boolean;
  checks: AnalysisEvaluationCheck[];
  notes: string[];
}

export interface LocalFaceGateEvaluationCaseResult {
  fixture_id: string;
  expected: LocalFaceGateExpectation;
  actual: LocalFaceGateExpectation;
  passed: boolean;
  confidence: number | null;
}

export interface LocalFaceGateEvaluationSummary {
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  pass_rate: number;
  min_pass_rate: number;
  passed: boolean;
  false_reject_count: number;
  false_reject_rate: number;
  false_accept_count: number;
  false_accept_rate: number;
  max_false_accept_rate: number;
  ml_detector_review_recommended: boolean;
  review_reasons: string[];
  results: LocalFaceGateEvaluationCaseResult[];
}

export interface AnalysisEvaluationReport {
  generated_at: string;
  model: string;
  prompt_version: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  gate: {
    min_pass_rate: number;
    pass_rate: number;
    passed: boolean;
    missing_required_cases: string[];
  };
  local_face_gate: LocalFaceGateEvaluationSummary;
  results: AnalysisEvaluationCaseResult[];
}

export function evaluateAnalysisResult(
  fixture: SkinJournalAnalysisEvaluationFixture,
  observations: AnalysisObservations,
): AnalysisEvaluationCaseResult {
  const checks: AnalysisEvaluationCheck[] = [
    qualityIssueCheck(fixture, observations),
    safetyFlagCheck(fixture, observations),
  ];
  if (fixture.expected.likely_quality_issue) {
    checks.push(qualityIssueCodeCheck(fixture, observations));
  }
  if (fixture.expected.likely_safety_reason) {
    checks.push(safetyReasonCodeCheck(fixture, observations));
  }

  return {
    fixture_id: fixture.id,
    passed: checks.every((check) => check.passed),
    checks,
    notes: [
      observations.user_visible_message ?? observations.overall_assessment,
    ].filter((note): note is string => note.length > 0),
  };
}

export function evaluateAnalysisPreflightRejection(
  fixture: SkinJournalAnalysisEvaluationFixture,
  issues: AnalysisPhotoPreflightIssue[],
): AnalysisEvaluationCaseResult {
  const normalizedQualityIssues = issues.includes('no_local_face_detected')
    ? ['non_face_image', ...issues]
    : issues;
  const checks: AnalysisEvaluationCheck[] = [
    {
      code: 'local_preflight_expected_rejection',
      passed: fixture.expected.local_preflight === 'reject',
      expected: fixture.expected.local_preflight,
      actual: 'reject',
    },
    {
      code: 'quality_issue_presence',
      passed: fixture.expected.should_include_quality_issue === true,
      expected: fixture.expected.should_include_quality_issue,
      actual: true,
    },
    {
      code: 'safety_flag_presence',
      passed: fixture.expected.should_flag_safety === false,
      expected: fixture.expected.should_flag_safety,
      actual: false,
    },
  ];
  if (fixture.expected.likely_quality_issue) {
    const expectedIssues = expectedQualityIssues(
      fixture.expected.likely_quality_issue,
    );
    checks.push({
      code: 'quality_issue_code',
      passed: expectedIssues.some((issue) =>
        normalizedQualityIssues.includes(issue),
      ),
      expected: fixture.expected.likely_quality_issue,
      actual: normalizedQualityIssues,
    });
  }

  return {
    fixture_id: fixture.id,
    passed: checks.every((check) => check.passed),
    checks,
    notes: [
      'External AI analysis skipped because local preflight rejected this fixture.',
    ],
  };
}

export function evaluateLocalFaceGateResult(
  fixture: SkinJournalAnalysisEvaluationFixture,
  result: { detected: boolean; confidence: number | null },
): LocalFaceGateEvaluationCaseResult {
  const actual: LocalFaceGateExpectation = result.detected ? 'pass' : 'reject';
  return {
    fixture_id: fixture.id,
    expected: fixture.expected.local_face_gate,
    actual,
    passed: actual === fixture.expected.local_face_gate,
    confidence:
      typeof result.confidence === 'number'
        ? Number(result.confidence.toFixed(3))
        : null,
  };
}

export function buildLocalFaceGateEvaluationSummary(
  results: LocalFaceGateEvaluationCaseResult[],
): LocalFaceGateEvaluationSummary {
  const passedCases = results.filter((result) => result.passed).length;
  const falseRejectCount = results.filter(
    (result) => result.expected === 'pass' && result.actual === 'reject',
  ).length;
  const falseAcceptCount = results.filter(
    (result) => result.expected === 'reject' && result.actual === 'pass',
  ).length;
  const passRate =
    results.length > 0 ? Number((passedCases / results.length).toFixed(4)) : 0;
  const falseRejectRate =
    results.length > 0
      ? Number((falseRejectCount / results.length).toFixed(4))
      : 0;
  const falseAcceptRate =
    results.length > 0
      ? Number((falseAcceptCount / results.length).toFixed(4))
      : 0;
  const reviewReasons: string[] = [];
  if (passRate < LOCAL_FACE_GATE_EVALUATION_MIN_PASS_RATE) {
    reviewReasons.push('local_face_gate_pass_rate_below_threshold');
  }
  if (falseRejectCount > 0) {
    reviewReasons.push('local_face_gate_false_rejects_present');
  }
  if (falseAcceptRate > LOCAL_FACE_GATE_EVALUATION_MAX_FALSE_ACCEPT_RATE) {
    reviewReasons.push('local_face_gate_false_accept_rate_high');
  }

  return {
    total_cases: results.length,
    passed_cases: passedCases,
    failed_cases: results.length - passedCases,
    pass_rate: passRate,
    min_pass_rate: LOCAL_FACE_GATE_EVALUATION_MIN_PASS_RATE,
    passed: reviewReasons.length === 0,
    false_reject_count: falseRejectCount,
    false_reject_rate: falseRejectRate,
    false_accept_count: falseAcceptCount,
    false_accept_rate: falseAcceptRate,
    max_false_accept_rate: LOCAL_FACE_GATE_EVALUATION_MAX_FALSE_ACCEPT_RATE,
    ml_detector_review_recommended: reviewReasons.length > 0,
    review_reasons: reviewReasons,
    results,
  };
}

export function buildAnalysisEvaluationReport(params: {
  model: string;
  promptVersion: string;
  results: AnalysisEvaluationCaseResult[];
  localFaceGateResults?: LocalFaceGateEvaluationCaseResult[];
  generatedAt?: Date;
}): AnalysisEvaluationReport {
  const passedCases = params.results.filter((result) => result.passed).length;
  const passRate =
    params.results.length > 0 ? passedCases / params.results.length : 0;
  const resultIds = new Set(params.results.map((result) => result.fixture_id));
  const missingRequiredCases =
    REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES.filter(
      (caseId) => !resultIds.has(caseId),
    );
  return {
    generated_at: (params.generatedAt ?? new Date()).toISOString(),
    model: params.model,
    prompt_version: params.promptVersion,
    total_cases: params.results.length,
    passed_cases: passedCases,
    failed_cases: params.results.length - passedCases,
    gate: {
      min_pass_rate: SKIN_JOURNAL_ANALYSIS_EVALUATION_MIN_PASS_RATE,
      pass_rate: Number(passRate.toFixed(4)),
      passed:
        missingRequiredCases.length === 0 &&
        passRate >= SKIN_JOURNAL_ANALYSIS_EVALUATION_MIN_PASS_RATE,
      missing_required_cases: missingRequiredCases,
    },
    local_face_gate: buildLocalFaceGateEvaluationSummary(
      params.localFaceGateResults ?? [],
    ),
    results: params.results,
  };
}

function qualityIssueCheck(
  fixture: SkinJournalAnalysisEvaluationFixture,
  observations: AnalysisObservations,
): AnalysisEvaluationCheck {
  const hasQualityIssue =
    observations.image_quality.needs_retake ||
    observations.image_quality.face_detected === false ||
    observations.image_quality.issues.length > 0;
  const expected = fixture.expected.should_include_quality_issue;
  return {
    code: 'quality_issue_presence',
    passed:
      expected === QUALITY_ISSUE_PRESENCE_OPTIONAL ||
      hasQualityIssue === expected,
    expected,
    actual: hasQualityIssue,
  };
}

function qualityIssueCodeCheck(
  fixture: SkinJournalAnalysisEvaluationFixture,
  observations: AnalysisObservations,
): AnalysisEvaluationCheck {
  const expectedIssues = expectedQualityIssues(
    fixture.expected.likely_quality_issue,
  );
  return {
    code: 'quality_issue_code',
    passed: observations.image_quality.issues.some((issue) =>
      expectedIssues.includes(issue),
    ),
    expected: fixture.expected.likely_quality_issue,
    actual: observations.image_quality.issues,
  };
}

function expectedQualityIssues(
  expected: SkinJournalAnalysisEvaluationFixture['expected']['likely_quality_issue'],
): string[] {
  if (!expected) {
    return [];
  }
  return typeof expected === 'string' ? [expected] : [...expected];
}

function safetyFlagCheck(
  fixture: SkinJournalAnalysisEvaluationFixture,
  observations: AnalysisObservations,
): AnalysisEvaluationCheck {
  const safetyFlags = observations.safety_flags;
  const hasSafetyFlag =
    safetyFlags?.urgent_review_recommended === true ||
    safetyFlags?.doctor_follow_up_recommended === true ||
    observations.should_flag_for_doctor;
  return {
    code: 'safety_flag_presence',
    passed: hasSafetyFlag === fixture.expected.should_flag_safety,
    expected: fixture.expected.should_flag_safety,
    actual: hasSafetyFlag,
  };
}

function safetyReasonCodeCheck(
  fixture: SkinJournalAnalysisEvaluationFixture,
  observations: AnalysisObservations,
): AnalysisEvaluationCheck {
  const expectedReason = fixture.expected.likely_safety_reason as string;
  const reasons = observations.safety_flags?.reasons ?? [];
  return {
    code: 'safety_reason_code',
    passed: reasons.some((reason) => reason === expectedReason),
    expected: expectedReason,
    actual: reasons,
  };
}
