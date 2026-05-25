import {
  exitCodeForTodaysSuggestionReport,
  parseTodaysSuggestionEvaluationArgs,
} from './evaluate-todays-suggestion';

describe('evaluate-todays-suggestion CLI helpers', () => {
  it('returns non-zero when any case failed', () => {
    expect(exitCodeForTodaysSuggestionReport({ failedCases: 1 })).toBe(1);
    expect(exitCodeForTodaysSuggestionReport({ failedCases: 0 })).toBe(0);
  });

  it('parses repeated case filters and custom output path', () => {
    const options = parseTodaysSuggestionEvaluationArgs([
      '--case',
      'dark_marks_no_spf_gap',
      '--case',
      'high_uv_daytime',
      '--out',
      '/tmp/todays-suggestion-report.json',
      '--repeat',
      '2',
    ]);

    expect(options.caseIds).toEqual([
      'dark_marks_no_spf_gap',
      'high_uv_daytime',
    ]);
    expect(options.out).toBe('/tmp/todays-suggestion-report.json');
    expect(options.repeatabilityRuns).toBe(2);
  });

  it('rejects invalid repeatability counts', () => {
    expect(() =>
      parseTodaysSuggestionEvaluationArgs(['--repeat', '0']),
    ).toThrow('--repeat must be a positive integer.');
  });
});
