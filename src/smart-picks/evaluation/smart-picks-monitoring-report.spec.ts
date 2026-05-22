import { buildSmartPicksMonitoringReport } from './smart-picks-monitoring-report';

describe('Smart Picks monitoring report', () => {
  it('summarizes warning signals without needing raw recommendation data', () => {
    const report = buildSmartPicksMonitoringReport({
      generatedAt: new Date('2026-05-14T08:00:00.000Z'),
      windowHours: 24,
      thresholds: { noPickCount: 2 },
      events: [
        event('smart_pick_ai_failed', 'warning'),
        event('smart_pick_no_pick', 'warning'),
        event('smart_pick_no_pick', 'warning'),
        event('smart_pick_unsafe_output_blocked', 'warning'),
      ],
    });

    expect(report.alerts).toEqual({
      aiFailures: true,
      unsafeOutputBlocked: true,
      noPickSpike: true,
      qualityDrift: false,
      degradedGeneration: false,
      lowPositiveFeedback: false,
    });
    expect(report.byKind).toContainEqual(
      expect.objectContaining({
        kind: 'smart_pick_no_pick',
        count: 2,
        warningCount: 2,
      }),
    );
    expect(report.recommendedActions).toEqual(
      expect.arrayContaining([
        'investigate_ai_provider',
        'review_no_pick_cases',
        'review_safety_guardrails',
      ]),
    );
  });

  it('tracks feedback trend without exposing raw product details', () => {
    const report = buildSmartPicksMonitoringReport({
      generatedAt: new Date('2026-05-14T08:00:00.000Z'),
      windowHours: 24,
      thresholds: {
        minFeedbackCount: 3,
        lowFeedbackSaveRate: 0.4,
      },
      events: [
        event('smart_pick_generation_completed', 'info'),
        event('smart_pick_user_feedback', 'info', { action: 'dismissed' }),
        event('smart_pick_user_feedback', 'info', { action: 'dismissed' }),
        event('smart_pick_user_feedback', 'info', { action: 'saved' }),
      ],
    });

    expect(report.feedback).toEqual({
      savedCount: 1,
      dismissedCount: 2,
      totalCount: 3,
      saveRate: 1 / 3,
    });
    expect(report.alerts.lowPositiveFeedback).toBe(true);
    expect(report.recommendedActions).toContain('review_low_save_feedback');
    expect(JSON.stringify(report)).not.toContain('normalizedKey');
  });

  it('uses rates so a large event volume can still raise alerts', () => {
    const report = buildSmartPicksMonitoringReport({
      generatedAt: new Date('2026-05-14T08:00:00.000Z'),
      windowHours: 24,
      thresholds: {
        aiFailureRate: 0.25,
        noPickRate: 0.3,
      },
      events: [
        event('smart_pick_generation_completed', 'info'),
        event('smart_pick_generation_completed', 'info'),
        event('smart_pick_generation_degraded', 'warning'),
        event('smart_pick_ai_failed', 'warning'),
        event('smart_pick_no_pick', 'warning'),
        event('smart_pick_no_pick', 'warning'),
      ],
    });

    expect(report.rates).toEqual(
      expect.objectContaining({
        aiFailureRate: 0.25,
        noPickRate: 0.5,
        degradedGenerationRate: 0.25,
      }),
    );
    expect(report.alerts.aiFailures).toBe(true);
    expect(report.alerts.noPickSpike).toBe(true);
  });
});

function event(
  kind:
    | 'smart_pick_generation_completed'
    | 'smart_pick_generation_degraded'
    | 'smart_pick_ai_failed'
    | 'smart_pick_no_pick'
    | 'smart_pick_unsafe_output_blocked'
    | 'smart_pick_user_feedback',
  severity: 'warning' | 'critical' | 'info',
  metadata: Record<string, string | number | boolean | null> = {},
) {
  return {
    kind,
    severity,
    metadata,
    createdAt: new Date('2026-05-14T07:00:00.000Z'),
  };
}
