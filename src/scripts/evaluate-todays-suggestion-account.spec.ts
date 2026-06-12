import {
  buildDiversitySummary,
  exitCodeForAccountSuggestionEvaluation,
  SlotEvaluationResult,
} from './evaluate-todays-suggestion-account';

describe('evaluate-todays-suggestion-account CLI helpers', () => {
  it('fails account evaluation when slot failures are present', () => {
    expect(
      exitCodeForAccountSuggestionEvaluation({
        failedSlotCount: 1,
        diversityWarnings: [],
      }),
    ).toBe(1);
  });

  it('fails account evaluation when diversity warnings are present', () => {
    expect(
      exitCodeForAccountSuggestionEvaluation({
        failedSlotCount: 0,
        diversityWarnings: ['morning repeated the same step signature.'],
      }),
    ).toBe(1);
  });

  it('passes only when slot checks and diversity checks pass', () => {
    expect(
      exitCodeForAccountSuggestionEvaluation({
        failedSlotCount: 0,
        diversityWarnings: [],
      }),
    ).toBe(0);
  });

  it('detects repeated same-time daypart signatures across different weekday slot ids', () => {
    const summary = buildDiversitySummary([
      accountSlot({ date: '2026-06-12', slotIdHash: 'fri-slot' }),
      accountSlot({ date: '2026-06-13', slotIdHash: 'sat-slot' }),
      accountSlot({ date: '2026-06-14', slotIdHash: 'sun-slot' }),
    ]);

    expect(summary.slotPatternSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotKey: '10:00:00:morning',
          daysEvaluated: 3,
          distinctStepSignatureCount: 1,
        }),
      ]),
    );
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        'morning slot 10:00:00 repeated the same step signature across 3 evaluated day(s).',
      ]),
    );
  });
});

function accountSlot(input: {
  date: string;
  slotIdHash: string;
}): SlotEvaluationResult {
  return {
    targetDate: input.date,
    targetDay: 'fri',
    slotIdHash: input.slotIdHash,
    slotTime: '10:00:00',
    daypart: 'morning',
    provider: 'openai',
    fallbackReason: null,
    activeProductCount: 2,
    activeCategoryCounts: { cleanser: 1, moisturizer: 1 },
    scoreDiagnostics: [
      productDiagnostic('cleanser-hash', 'cleanser'),
      productDiagnostic('moisturizer-hash', 'moisturizer'),
    ],
    stepCount: 2,
    stepCategories: ['cleanser', 'moisturizer'],
    stepProductHashes: ['cleanser-hash', 'moisturizer-hash'],
    stepSignatureHash: 'same-basic-signature',
    failures: [],
  };
}

function productDiagnostic(productHash: string, category: string) {
  return {
    productHash,
    category,
    preferredTimeOfDay: null,
    suitabilityScore: 80,
    dataQuality: 'verified',
    activeTags: [],
    cautionReasons: [],
  };
}
