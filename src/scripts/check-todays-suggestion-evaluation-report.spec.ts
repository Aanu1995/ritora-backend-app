import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  evaluateTodaysSuggestionEvaluationGate,
  parseTodaysSuggestionEvaluationGateArgs,
  runTodaysSuggestionEvaluationGateCli,
  TodaysSuggestionEvaluationGateReport,
} from './check-todays-suggestion-evaluation-report';

describe("Today's Suggestion evaluation report gate", () => {
  it('passes a report that meets failure and pass-rate thresholds', () => {
    const result = evaluateTodaysSuggestionEvaluationGate(passingReport(), {
      maxFailedCases: 0,
      maxRepeatabilityFailures: 0,
      minPassRate: 1,
      requiredCaseIds: ['case-a', 'case-b'],
    });

    expect(result).toEqual({
      pass: true,
      passRate: 1,
      reasons: [],
    });
  });

  it('fails reports below pass-rate or repeatability thresholds', () => {
    const result = evaluateTodaysSuggestionEvaluationGate(
      {
        ...passingReport(),
        failedCases: 1,
        passedCases: 1,
        repeatabilityFailures: 1,
      },
      {
        maxFailedCases: 0,
        maxRepeatabilityFailures: 0,
        minPassRate: 0.95,
        requiredCaseIds: [],
      },
    );

    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'Pass rate 0.500 is below required 0.950.',
        'Failed cases 1 exceeds allowed 0.',
        'Repeatability failures 1 exceeds allowed 0.',
      ]),
    );
  });

  it('fails when required golden cases are missing from the report', () => {
    const result = evaluateTodaysSuggestionEvaluationGate(passingReport(), {
      maxFailedCases: 0,
      maxRepeatabilityFailures: 0,
      minPassRate: 1,
      requiredCaseIds: ['case-a', 'pregnancy_retinoid_caution'],
    });

    expect(result.pass).toBe(false);
    expect(result.reasons).toContain(
      'Missing required case ids: pregnancy_retinoid_caution.',
    );
  });

  it('parses CLI thresholds and repeated reports', () => {
    expect(
      parseTodaysSuggestionEvaluationGateArgs([
        '--report',
        'a.json',
        '--report',
        'b.json',
        '--min-pass-rate',
        '0.98',
        '--max-failed',
        '1',
        '--max-repeatability-failures',
        '2',
        '--required-case',
        'case-a',
      ]),
    ).toEqual(
      expect.objectContaining({
        maxFailedCases: 1,
        maxRepeatabilityFailures: 2,
        minPassRate: 0.98,
        requiredCaseIds: ['case-a'],
        reportPaths: [
          expect.stringContaining('a.json'),
          expect.stringContaining('b.json'),
        ],
      }),
    );
  });

  it('returns a failing CLI exit code for a stale or weak report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'todays-suggestion-gate-'));
    const reportPath = join(directory, 'report.json');
    await writeFile(
      reportPath,
      JSON.stringify({ ...passingReport(), failedCases: 1, passedCases: 1 }),
      'utf8',
    );

    try {
      await expect(
        runTodaysSuggestionEvaluationGateCli([
          '--report',
          reportPath,
          '--min-pass-rate',
          '1',
          '--max-failed',
          '0',
        ]),
      ).resolves.toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function passingReport(): TodaysSuggestionEvaluationGateReport {
  return {
    totalCases: 2,
    passedCases: 2,
    failedCases: 0,
    repeatabilityFailures: 0,
    cases: [
      { caseId: 'case-a', status: 'passed' },
      { caseId: 'case-b', status: 'passed' },
    ],
  };
}
