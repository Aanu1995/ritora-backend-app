import type { AnalysisObservations } from '../skin-journal.constants';
import type { SkinJournalAnalysisEvaluationFixture } from './skin-journal-analysis-evaluation.fixtures';

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

export interface AnalysisEvaluationReport {
  generated_at: string;
  model: string;
  prompt_version: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
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

export function buildAnalysisEvaluationReport(params: {
  model: string;
  promptVersion: string;
  results: AnalysisEvaluationCaseResult[];
  generatedAt?: Date;
}): AnalysisEvaluationReport {
  const passedCases = params.results.filter((result) => result.passed).length;
  return {
    generated_at: (params.generatedAt ?? new Date()).toISOString(),
    model: params.model,
    prompt_version: params.promptVersion,
    total_cases: params.results.length,
    passed_cases: passedCases,
    failed_cases: params.results.length - passedCases,
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
  return {
    code: 'quality_issue_presence',
    passed: hasQualityIssue === fixture.expected.should_include_quality_issue,
    expected: fixture.expected.should_include_quality_issue,
    actual: hasQualityIssue,
  };
}

function qualityIssueCodeCheck(
  fixture: SkinJournalAnalysisEvaluationFixture,
  observations: AnalysisObservations,
): AnalysisEvaluationCheck {
  const expectedIssue = fixture.expected.likely_quality_issue as string;
  return {
    code: 'quality_issue_code',
    passed: observations.image_quality.issues.some(
      (issue) => issue === expectedIssue,
    ),
    expected: expectedIssue,
    actual: observations.image_quality.issues,
  };
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
