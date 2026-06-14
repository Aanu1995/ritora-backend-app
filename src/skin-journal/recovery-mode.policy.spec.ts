import {
  buildRecoveryModeStart,
  shouldStartRecoveryModeFromReactionReport,
} from './recovery-mode.policy';
import type { ReactionReportPayload } from './skin-journal.constants';

function report(
  overrides: Partial<ReactionReportPayload> = {},
): ReactionReportPayload {
  return {
    symptoms: ['burning'],
    severity: 'mild',
    onset: 'today',
    locations: ['cheeks'],
    red_flags: [],
    suspected_trigger: 'unknown',
    note: null,
    ...overrides,
  };
}

describe('recovery mode policy', () => {
  const now = new Date('2026-06-14T12:00:00.000Z');

  it('starts Recovery Mode for barrier symptoms even when the reaction is mild', () => {
    const payload = report({ symptoms: ['burning', 'tightness'] });

    expect(shouldStartRecoveryModeFromReactionReport(payload)).toBe(true);
    expect(buildRecoveryModeStart(payload, now)).toMatchObject({
      phase: 'stabilize',
      trigger_source: 'reaction_report',
      trigger_symptoms: ['burning', 'tightness'],
      trigger_severity: 'mild',
      active_overuse: false,
      return_step: 'not_started',
    });
  });

  it('does not start Recovery Mode for mild breakout-only reports', () => {
    expect(
      shouldStartRecoveryModeFromReactionReport(
        report({ symptoms: ['breakout'], severity: 'mild' }),
      ),
    ).toBe(false);
  });

  it('treats red flags as severe and keeps the exit window conservative', () => {
    const start = buildRecoveryModeStart(
      report({
        severity: 'mild',
        symptoms: ['stinging'],
        red_flags: ['blistering'],
      }),
      now,
    );

    expect(start.trigger_severity).toBe('severe');
    expect(start.review_after?.toISOString()).toBe('2026-06-17T12:00:00.000Z');
    expect(start.exit_eligible_at?.toISOString()).toBe(
      '2026-06-21T12:00:00.000Z',
    );
  });

  it('starts Recovery Mode for red flags even when the user did not select a barrier symptom', () => {
    const payload = report({
      severity: 'mild',
      symptoms: [],
      red_flags: ['spreading_fast'],
    });

    expect(shouldStartRecoveryModeFromReactionReport(payload)).toBe(true);
    expect(buildRecoveryModeStart(payload, now)).toMatchObject({
      trigger_symptoms: [],
      trigger_severity: 'severe',
      return_step: 'not_started',
    });
  });

  it('marks likely active overuse when the report suspects an active ingredient', () => {
    expect(
      buildRecoveryModeStart(
        report({ suspected_trigger: 'active_ingredient' }),
        now,
      ),
    ).toMatchObject({
      active_overuse: true,
    });
  });
});
