import type { AnalysisObservations } from '../skin-journal.constants';
import {
  QUALITY_ISSUE_PRESENCE_OPTIONAL,
  REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES,
  SKIN_JOURNAL_ANALYSIS_EVALUATION_MIN_PASS_RATE,
} from './skin-journal-analysis-evaluation.fixtures';
import type { SkinJournalAnalysisEvaluationFixture } from './skin-journal-analysis-evaluation.fixtures';
import {
  buildAnalysisEvaluationReport,
  buildLocalFaceGateEvaluationSummary,
  evaluateAnalysisResult,
  evaluateAnalysisPreflightRejection,
  evaluateLocalFaceGateResult,
} from './skin-journal-analysis-evaluation.runner';

const fixture: SkinJournalAnalysisEvaluationFixture = {
  id: 'severe-reaction-like',
  private_image_filename: 'severe-reaction-like.webp',
  description: 'Widespread intense irritation-like signal.',
  expected: {
    local_face_gate: 'pass',
    local_preflight: 'pass',
    should_include_quality_issue: false,
    should_flag_safety: true,
    likely_safety_reason: 'widespread_severe_irritation',
  },
};

const observations: AnalysisObservations = {
  schema_version: '1.1',
  model_version: 'test-model',
  image_quality: {
    face_detected: true,
    lighting_quality: 'good',
    framing_quality: 'good',
    blur_detected: false,
    issues: [],
    quality_score: 0.9,
    needs_retake: false,
    excluded_from_trends_reason: null,
  },
  detected_concerns: [],
  reaction_signals: {
    reaction_detected: true,
    reaction_severity: 'severe',
    indicators: ['redness_spike'],
    confidence: 0.8,
  },
  barrier_signs: { barrier_compromise: true, indicators: [] },
  overall_assessment: 'Visible irritation signals are strong.',
  overall_change_from_previous: 'unknown',
  user_visible_message: 'Visible irritation signals are strong.',
  safety_flags: {
    urgent_review_recommended: true,
    doctor_follow_up_recommended: true,
    reasons: ['widespread_severe_irritation'],
  },
  should_flag_for_doctor: true,
};

describe('Skin Journal analysis evaluation runner', () => {
  it('evaluates fixture expectations against model observations', () => {
    const result = evaluateAnalysisResult(fixture, observations);

    expect(result).toMatchObject({
      fixture_id: 'severe-reaction-like',
      passed: true,
    });
    expect(result.checks.map((check) => check.code)).toContain(
      'safety_reason_code',
    );
    expect(result.checks.map((check) => check.code)).toContain(
      'guidance_decision_integrity',
    );
  });

  it('passes guidance integrity when generated guidance matches a high-confidence concern', () => {
    const result = evaluateAnalysisResult(fixture, {
      ...observations,
      detected_concerns: [
        {
          concern: 'acne',
          severity: 'moderate',
          locations: ['chin'],
          confidence: 0.78,
          change_from_previous: 'new',
          change_confidence: 0.62,
        },
      ],
      guidance_decisions: [
        {
          concern: 'acne',
          possible_factor_codes: ['acne_common_contributors'],
          possible_cause_items: [
            'Pore clogging, sweat, stress, or a recent product change could be contributors to compare.',
          ],
          action_codes: ['log_clusters'],
          try_next_items: [
            'Log whether new spots cluster after sweat, food notes, or product changes.',
          ],
          avoid_codes: ['pore_clogging_products'],
          avoid_items: ['Avoid heavy products on areas that are breaking out.'],
          reasoning_summary:
            'Visible chin breakout pattern with safe guidance.',
        },
      ],
    });

    expect(
      result.checks.find(
        (check) => check.code === 'guidance_decision_integrity',
      ),
    ).toMatchObject({ passed: true });
    expect(result.notes.join('\n')).toContain('Possible cause: Pore clogging');
    expect(result.notes.join('\n')).toContain('Try next: Log whether');
    expect(result.notes.join('\n')).toContain('Avoid: Avoid heavy products');
  });

  it('fails guidance integrity when a usable high-confidence concern lacks guidance', () => {
    const result = evaluateAnalysisResult(fixture, {
      ...observations,
      detected_concerns: [
        {
          concern: 'acne',
          severity: 'moderate',
          locations: ['chin'],
          confidence: 0.78,
          change_from_previous: 'new',
          change_confidence: 0.62,
        },
      ],
      guidance_decisions: [],
    });

    expect(
      result.checks.find(
        (check) => check.code === 'guidance_decision_integrity',
      ),
    ).toMatchObject({
      passed: false,
      actual: expect.objectContaining({
        invalid_reasons: expect.arrayContaining([
          'missing_guidance_for_high_confidence_concern:acne',
        ]),
      }),
    });
    expect(result.passed).toBe(false);
  });

  it('fails guidance integrity when generated guidance contains unsafe overclaims', () => {
    const result = evaluateAnalysisResult(fixture, {
      ...observations,
      detected_concerns: [
        {
          concern: 'acne',
          severity: 'moderate',
          locations: ['chin'],
          confidence: 0.78,
          change_from_previous: 'new',
          change_confidence: 0.62,
        },
      ],
      guidance_decisions: [
        {
          concern: 'acne',
          possible_factor_codes: ['acne_common_contributors'],
          possible_cause_items: ['This proves milk caused your acne.'],
          action_codes: ['log_clusters'],
          try_next_items: [
            'Log whether new spots cluster after sweat, food notes, or product changes.',
          ],
          avoid_codes: ['pore_clogging_products'],
          avoid_items: ['Stop all products immediately.'],
          reasoning_summary: 'Unsafe guidance should fail.',
        },
      ],
    });

    expect(
      result.checks.find(
        (check) => check.code === 'guidance_decision_integrity',
      ),
    ).toMatchObject({
      passed: false,
      actual: expect.objectContaining({
        invalid_reasons: expect.arrayContaining([
          'unsafe_generated_guidance:acne:possible_cause_items',
          'unsafe_generated_guidance:acne:avoid_items',
        ]),
      }),
    });
  });

  it('accepts any matching quality code for fixture families with model wording variance', () => {
    const darkLightingFixture: SkinJournalAnalysisEvaluationFixture = {
      ...fixture,
      id: 'dark-lighting',
      private_image_filename: 'dark-lighting.webp',
      expected: {
        local_face_gate: 'pass',
        local_preflight: 'pass',
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: ['too_dark', 'harsh_shadows'],
      },
    };
    const darkLightingObservations: AnalysisObservations = {
      ...observations,
      image_quality: {
        ...observations.image_quality,
        lighting_quality: 'poor',
        issues: ['harsh_shadows'],
        quality_score: 0.38,
        needs_retake: true,
        excluded_from_trends_reason: 'poor_lighting',
      },
      safety_flags: {
        urgent_review_recommended: false,
        doctor_follow_up_recommended: false,
        reasons: [],
      },
      should_flag_for_doctor: false,
    };

    const result = evaluateAnalysisResult(
      darkLightingFixture,
      darkLightingObservations,
    );

    expect(result.passed).toBe(true);
    expect(
      result.checks.find((check) => check.code === 'quality_issue_code'),
    ).toMatchObject({
      passed: true,
      expected: ['too_dark', 'harsh_shadows'],
      actual: ['harsh_shadows'],
    });
  });

  it('allows optional quality issue presence for borderline fixture quality', () => {
    const borderlineFixture: SkinJournalAnalysisEvaluationFixture = {
      ...fixture,
      id: 'deep-skin-tone-even-light',
      private_image_filename: 'deep-skin-tone-even-light.webp',
      expected: {
        local_face_gate: 'pass',
        local_preflight: 'pass',
        should_include_quality_issue: QUALITY_ISSUE_PRESENCE_OPTIONAL,
        should_flag_safety: false,
      },
    };
    const result = evaluateAnalysisResult(borderlineFixture, {
      ...observations,
      image_quality: {
        ...observations.image_quality,
        issues: [],
        quality_score: 0.86,
        needs_retake: false,
      },
      safety_flags: {
        urgent_review_recommended: false,
        doctor_follow_up_recommended: false,
        reasons: [],
      },
      should_flag_for_doctor: false,
    });

    expect(result.passed).toBe(true);
    expect(
      result.checks.find((check) => check.code === 'quality_issue_presence'),
    ).toMatchObject({
      passed: true,
      expected: QUALITY_ISSUE_PRESENCE_OPTIONAL,
      actual: false,
    });
  });

  it('builds a stable private report shape', () => {
    const localFaceGateResults = [
      evaluateLocalFaceGateResult(fixture, {
        detected: true,
        confidence: 0.82,
      }),
    ];
    const report = buildAnalysisEvaluationReport({
      model: 'gpt-test',
      promptVersion: 'prompt-test',
      generatedAt: new Date('2026-04-30T00:00:00.000Z'),
      results: [evaluateAnalysisResult(fixture, observations)],
      localFaceGateResults,
    });

    expect(report).toEqual(
      expect.objectContaining({
        generated_at: '2026-04-30T00:00:00.000Z',
        model: 'gpt-test',
        prompt_version: 'prompt-test',
        total_cases: 1,
        passed_cases: 1,
        failed_cases: 0,
        local_face_gate: expect.objectContaining({
          total_cases: 1,
          passed_cases: 1,
          false_reject_count: 0,
          false_accept_count: 0,
          ml_detector_review_recommended: false,
        }),
        gate: expect.objectContaining({
          min_pass_rate: SKIN_JOURNAL_ANALYSIS_EVALUATION_MIN_PASS_RATE,
          pass_rate: 1,
          passed: false,
          missing_required_cases:
            REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES.filter(
              (caseId) => caseId !== fixture.id,
            ),
        }),
      }),
    );
  });

  it('fails the evaluation gate when a required fixture is missing', () => {
    const report = buildAnalysisEvaluationReport({
      model: 'gpt-test',
      promptVersion: 'prompt-test',
      generatedAt: new Date('2026-04-30T00:00:00.000Z'),
      results: [evaluateAnalysisResult(fixture, observations)],
    });

    expect(report.gate.passed).toBe(false);
    expect(report.gate.missing_required_cases).toContain('no-face');
  });

  it('passes the evaluation gate only when all required fixtures meet the threshold', () => {
    const results = REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES.map(
      (caseId) => ({
        fixture_id: caseId,
        passed: true,
        checks: [],
        notes: [],
      }),
    );

    const report = buildAnalysisEvaluationReport({
      model: 'gpt-test',
      promptVersion: 'prompt-test',
      generatedAt: new Date('2026-04-30T00:00:00.000Z'),
      results,
    });

    expect(report.gate).toEqual({
      min_pass_rate: SKIN_JOURNAL_ANALYSIS_EVALUATION_MIN_PASS_RATE,
      pass_rate: 1,
      passed: true,
      missing_required_cases: [],
    });
  });

  it('summarizes local face gate calibration and flags detector review when it misses', () => {
    const noFaceFixture: SkinJournalAnalysisEvaluationFixture = {
      ...fixture,
      id: 'no-face',
      private_image_filename: 'no-face.webp',
      expected: {
        local_face_gate: 'reject',
        local_preflight: 'pass',
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: 'non_face_image',
      },
    };
    const results = [
      evaluateLocalFaceGateResult(fixture, {
        detected: false,
        confidence: 0.18,
      }),
      evaluateLocalFaceGateResult(noFaceFixture, {
        detected: true,
        confidence: 0.77,
      }),
    ];

    const summary = buildLocalFaceGateEvaluationSummary(results);

    expect(summary).toMatchObject({
      total_cases: 2,
      passed_cases: 0,
      false_reject_count: 1,
      false_accept_count: 1,
      passed: false,
      ml_detector_review_recommended: true,
    });
    expect(summary.review_reasons).toEqual(
      expect.arrayContaining([
        'local_face_gate_false_rejects_present',
        'local_face_gate_false_accept_rate_high',
      ]),
    );
  });

  it('treats expected local preflight rejection as a privacy-preserving analysis result', () => {
    const noFaceFixture: SkinJournalAnalysisEvaluationFixture = {
      ...fixture,
      id: 'no-face',
      private_image_filename: 'no-face.webp',
      expected: {
        local_face_gate: 'reject',
        local_preflight: 'reject',
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: 'non_face_image',
      },
    };

    const result = evaluateAnalysisPreflightRejection(noFaceFixture, [
      'no_local_face_detected',
    ]);

    expect(result).toMatchObject({
      fixture_id: 'no-face',
      passed: true,
    });
    expect(result.checks.map((check) => check.code)).toEqual(
      expect.arrayContaining([
        'local_preflight_expected_rejection',
        'quality_issue_code',
      ]),
    );
  });

  it('records unexpected local preflight rejection as a failed fixture instead of hiding it', () => {
    const result = evaluateAnalysisPreflightRejection(fixture, [
      'no_local_face_detected',
    ]);

    expect(result).toMatchObject({
      fixture_id: 'severe-reaction-like',
      passed: false,
    });
    expect(
      result.checks.find(
        (check) => check.code === 'local_preflight_expected_rejection',
      ),
    ).toMatchObject({
      passed: false,
      expected: 'pass',
      actual: 'reject',
    });
  });
});
