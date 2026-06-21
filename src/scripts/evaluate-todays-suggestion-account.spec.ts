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
      accountSlot({
        date: '2026-06-12',
        slotIdHash: 'fri-slot',
        includeEligibleAlternative: true,
      }),
      accountSlot({
        date: '2026-06-13',
        slotIdHash: 'sat-slot',
        includeEligibleAlternative: true,
      }),
      accountSlot({
        date: '2026-06-14',
        slotIdHash: 'sun-slot',
        includeEligibleAlternative: true,
      }),
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

  it('does not flag repeated signatures when no eligible unselected alternative exists', () => {
    const summary = buildDiversitySummary([
      accountSlot({
        date: '2026-06-12',
        slotIdHash: 'fri-slot',
        includeEligibleAlternative: false,
      }),
      accountSlot({
        date: '2026-06-13',
        slotIdHash: 'sat-slot',
        includeEligibleAlternative: false,
      }),
      accountSlot({
        date: '2026-06-14',
        slotIdHash: 'sun-slot',
        includeEligibleAlternative: false,
      }),
    ]);

    expect(summary.slotPatternSummaries[0]).toEqual(
      expect.objectContaining({
        daysEvaluated: 3,
        distinctStepSignatureCount: 1,
      }),
    );
    expect(summary.warnings).toEqual([]);
  });

  it('does not count recently repeated products as diversity alternatives', () => {
    const summary = buildDiversitySummary([
      accountSlot({
        date: '2026-06-12',
        slotIdHash: 'fri-slot',
        includeEligibleAlternative: false,
        repeatedAlternativeCategory: 'cleanser',
      }),
      accountSlot({
        date: '2026-06-13',
        slotIdHash: 'sat-slot',
        includeEligibleAlternative: false,
        repeatedAlternativeCategory: 'cleanser',
      }),
      accountSlot({
        date: '2026-06-14',
        slotIdHash: 'sun-slot',
        includeEligibleAlternative: false,
        repeatedAlternativeCategory: 'cleanser',
      }),
    ]);

    expect(summary.warnings).toEqual([]);
  });

  it('does not flag a daypart when eligible alternatives are selected elsewhere in the evaluated plan', () => {
    const summary = buildDiversitySummary([
      accountSlot({
        date: '2026-06-12',
        slotIdHash: 'fri-morning-slot',
        includeEligibleAlternative: true,
      }),
      accountSlot({
        date: '2026-06-13',
        slotIdHash: 'sat-morning-slot',
        includeEligibleAlternative: true,
      }),
      accountSlot({
        date: '2026-06-14',
        slotIdHash: 'sun-morning-slot',
        includeEligibleAlternative: true,
      }),
      eveningSerumSlot('2026-06-12', 'fri-evening-slot'),
      eveningSerumSlot('2026-06-13', 'sat-evening-slot'),
      eveningSerumSlot('2026-06-14', 'sun-evening-slot'),
    ]);

    expect(summary.warnings).toEqual([]);
  });
});

function accountSlot(input: {
  date: string;
  slotIdHash: string;
  includeEligibleAlternative: boolean;
  repeatedAlternativeCategory?: string;
}): SlotEvaluationResult {
  const scoreDiagnostics = [
    productDiagnostic('cleanser-hash', 'cleanser'),
    productDiagnostic('moisturizer-hash', 'moisturizer'),
  ];
  if (input.includeEligibleAlternative) {
    scoreDiagnostics.push(productDiagnostic('serum-hash', 'serum'));
  }
  if (input.repeatedAlternativeCategory) {
    scoreDiagnostics.push(
      productDiagnostic(
        `${input.repeatedAlternativeCategory}-recent-hash`,
        input.repeatedAlternativeCategory,
        ['recent same-daypart repeat'],
      ),
    );
  }

  return {
    targetDate: input.date,
    targetDay: 'fri',
    slotIdHash: input.slotIdHash,
    slotTime: '10:00:00',
    daypart: 'morning',
    provider: 'openai',
    fallbackReason: null,
    activeProductCount: scoreDiagnostics.length,
    activeCategoryCounts: input.includeEligibleAlternative
      ? { cleanser: 1, moisturizer: 1, serum: 1 }
      : { cleanser: 1, moisturizer: 1 },
    scoreDiagnostics,
    stepCount: 2,
    stepCategories: ['cleanser', 'moisturizer'],
    stepProductHashes: ['cleanser-hash', 'moisturizer-hash'],
    stepSignatureHash: 'same-basic-signature',
    failures: [],
  };
}

function productDiagnostic(
  productHash: string,
  category: string,
  cautionReasons: string[] = [],
) {
  return {
    productHash,
    category,
    preferredTimeOfDay: null,
    suitabilityScore: 80,
    dataQuality: 'verified',
    activeTags: [],
    cautionReasons,
  };
}

function eveningSerumSlot(
  date: string,
  slotIdHash: string,
): SlotEvaluationResult {
  return {
    targetDate: date,
    targetDay: 'fri',
    slotIdHash,
    slotTime: '20:00:00',
    daypart: 'evening',
    provider: 'openai',
    fallbackReason: null,
    activeProductCount: 1,
    activeCategoryCounts: { serum: 1 },
    scoreDiagnostics: [productDiagnostic('serum-hash', 'serum')],
    stepCount: 1,
    stepCategories: ['serum'],
    stepProductHashes: ['serum-hash'],
    stepSignatureHash: 'same-evening-serum-signature',
    failures: [],
  };
}
