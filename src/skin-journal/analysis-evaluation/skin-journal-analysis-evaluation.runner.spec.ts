import type { AnalysisObservations } from '../skin-journal.constants';
import type { SkinJournalAnalysisEvaluationFixture } from './skin-journal-analysis-evaluation.fixtures';
import {
  buildAnalysisEvaluationReport,
  evaluateAnalysisResult,
} from './skin-journal-analysis-evaluation.runner';

const fixture: SkinJournalAnalysisEvaluationFixture = {
  id: 'severe-reaction-like',
  private_image_filename: 'severe-reaction-like.webp',
  description: 'Widespread intense irritation-like signal.',
  expected: {
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
  });

  it('builds a stable private report shape', () => {
    const report = buildAnalysisEvaluationReport({
      model: 'gpt-test',
      promptVersion: 'prompt-test',
      generatedAt: new Date('2026-04-30T00:00:00.000Z'),
      results: [evaluateAnalysisResult(fixture, observations)],
    });

    expect(report).toEqual(
      expect.objectContaining({
        generated_at: '2026-04-30T00:00:00.000Z',
        model: 'gpt-test',
        prompt_version: 'prompt-test',
        total_cases: 1,
        passed_cases: 1,
        failed_cases: 0,
      }),
    );
  });
});
