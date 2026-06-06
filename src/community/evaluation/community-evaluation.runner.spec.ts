import {
  buildCommunityEvaluationReport,
  type CommunityEvaluationReport,
} from './community-evaluation.runner';

describe('Community evaluation runner', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;
  const originalAbortSignalTimeout = AbortSignal.timeout;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      COMMUNITY_MODERATION_AI_MODEL: 'community-eval-model',
      OPENAI_API_KEY: 'community-eval-key',
    };
    globalThis.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              action: 'publish',
              confidence: 0.97,
              reason: 'Safe community content.',
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    if (!AbortSignal.timeout) {
      Object.defineProperty(AbortSignal, 'timeout', {
        configurable: true,
        value: () => new AbortController().signal,
      });
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: originalAbortSignalTimeout,
    });
  });

  it('evaluates the redesigned community playbook and AI guardrail cases without a database workflow', async () => {
    const report = await buildCommunityEvaluationReport({
      generatedAt: new Date('2026-05-24T12:00:00.000Z'),
      includeDatabaseWorkflow: false,
      requireLiveAi: true,
    });

    expect(report.gate.passed).toBe(true);
    expect(caseIds(report)).toEqual(
      expect.arrayContaining([
        'goal_playbook_lifestyle_auto_publish',
        'prompt_injection_request_edit',
        'missing_sunscreen_request_edit',
      ]),
    );
    expect(simulationIds(report)).toEqual(
      expect.arrayContaining([
        'llm_publish_overridden_for_missing_sunscreen',
        'llm_publish_overridden_for_moderation_manipulation',
        'critical_guardrail_bypasses_llm_publish_attempt',
      ]),
    );
    expect(report.workflow.status).toBe('skipped');
    expect(report.liveAi.observed).toBe(true);
  });
});

function caseIds(report: CommunityEvaluationReport): string[] {
  return report.moderationCases.map((item) => item.caseId);
}

function simulationIds(report: CommunityEvaluationReport): string[] {
  return report.guardrailSimulations.map((item) => item.id);
}
