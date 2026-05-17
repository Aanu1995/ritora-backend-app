import {
  buildSkinJournalInsightEvaluationReport,
  containsUnsafeClinicalInsightCopy,
} from './skin-journal-insight-evaluation.runner';
import {
  REQUIRED_SKIN_JOURNAL_INSIGHT_EVALUATION_CASES,
  SKIN_JOURNAL_INSIGHT_EVALUATION_FIXTURES,
} from './skin-journal-insight-evaluation.fixtures';

describe('skin journal insight evaluation gate', () => {
  it('passes the curated golden set across trend, routine, quality, cycle, and safety scenarios', () => {
    const report = buildSkinJournalInsightEvaluationReport({
      generatedAt: new Date('2026-05-17T09:00:00.000Z'),
    });

    expect(report.gate.passed).toBe(true);
    expect(report.gate.missing_required_cases).toEqual([]);
    expect(report.copy_review.passed).toBe(true);
    expect(report.total_cases).toBe(
      SKIN_JOURNAL_INSIGHT_EVALUATION_FIXTURES.length,
    );
    expect(report.total_cases).toBeGreaterThanOrEqual(
      REQUIRED_SKIN_JOURNAL_INSIGHT_EVALUATION_CASES.length,
    );
    expect(report.results.map((result) => result.fixture_id)).toEqual(
      expect.arrayContaining([
        ...REQUIRED_SKIN_JOURNAL_INSIGHT_EVALUATION_CASES,
      ]),
    );
  });

  it('flags deterministic or AI-polished copy that drifts into clinical claims', () => {
    expect(
      containsUnsafeClinicalInsightCopy(
        'This product caused acne and will cure irritation.',
      ),
    ).toBe(true);
    expect(
      containsUnsafeClinicalInsightCopy(
        'Your logs show redness appeared alongside high-stress days.',
      ),
    ).toBe(false);
  });

  it('keeps broad public launch blocked until clinical and legal review is approved', () => {
    const report = buildSkinJournalInsightEvaluationReport({
      generatedAt: new Date('2026-05-17T09:00:00.000Z'),
      requireBroadLaunchClinicalReview: true,
    });

    expect(report.gate.passed).toBe(false);
    expect(report.launch_readiness.broad_public_launch_ready).toBe(false);
    expect(report.launch_readiness.clinical_legal_review.approved).toBe(false);
    expect(report.launch_readiness.blockers).toContain(
      'clinical_legal_review_not_approved',
    );
  });
});
