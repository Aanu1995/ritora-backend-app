import {
  SmartPicksAiGenerationResult,
  SmartPicksAiPlanGenerationResult,
} from '../services/smart-picks-ai-generator';
import {
  SmartPicksCoverageRole,
  SmartPicksGapKind,
} from '../smart-picks.types';
import { SMART_PICKS_GOLDEN_PERSONAS } from './smart-picks-golden-personas';
import {
  buildGoldenSmartPicksContext,
  buildSmartPicksEvaluationReport,
  evaluateSmartPicksPersona,
  SmartPicksEvaluationGenerator,
} from './smart-picks-evaluation.runner';

describe('Smart Picks evaluation runner', () => {
  it('scores a golden persona without leaking environment secrets', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS[0];
    const generator = generatorForPersona(persona);

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.status).toBe('passed');
    expect(result.score).toBe(1);
    expect(result.coverageRoles).toEqual([...persona.expected.coverageRoles]);
    expect(result.priorityGapKeys).toEqual([
      ...persona.expected.priorityGapKeys,
    ]);
    expect(result.considerGapKeys).toEqual(
      expect.arrayContaining([...persona.expected.considerGapKeys]),
    );
    expect(result.considerGapKeys.length).toBeGreaterThanOrEqual(
      expectedMinimumConsiderGapCount(persona),
    );
    expect(JSON.stringify(result)).not.toContain('OPENAI_API_KEY');
    expect(JSON.stringify(result)).not.toContain('AWS_SECRET_ACCESS_KEY');
  });

  it('marks drifted outputs for review or failure', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS[0];
    const generator = generatorForPersona(persona, {
      priorityGaps: [],
      considerGaps: [],
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.status).not.toBe('passed');
    expect(result.checks.some((check) => !check.passed)).toBe(true);
  });

  it('accepts semantically equivalent gap wording from live models', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS[0];
    const generator = generatorForPersona(persona, {
      priorityGaps: [
        gap('gentle-fragrance-free-cleanser', 'priority'),
        gap(
          'lightweight-non-comedogenic-moisturizer-with-barrier-supporting-ceramides-glycerin',
          'priority',
        ),
        gap(
          'broad-spectrum-spf-50-sunscreen-with-minimal-white-cast-tinted-or-sheer-absorbing-formula',
          'priority',
        ),
        gap('azelaic-acid-10-15-treatment', 'priority'),
      ],
      considerGaps: [
        gap('vitamin-c-antioxidant-serum', 'consider'),
        gap('weekly-pigment-support-peel', 'consider'),
      ],
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.status).toBe('passed');
    expect(
      result.checks.filter((check) =>
        ['priority_gaps', 'consider_gaps'].includes(check.id),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'priority_gaps', passed: true }),
        expect.objectContaining({ id: 'consider_gaps', passed: true }),
      ]),
    );
  });

  it('accepts semantically equivalent coverage roles without failing on useful extras', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) =>
        candidate.id ===
        'refine_full_shelf_premium_tone_australia_optional_support',
    );
    if (!persona) throw new Error('Expected premium tone persona.');
    const generator = generatorForPersona(persona, {
      coverage: {
        slots: [
          'cleanse',
          'moisturise',
          'spf',
          'dark-spot-treatment',
          'antioxidant',
          'texture-exfoliant',
          'barrier-support',
        ].map((role: SmartPicksCoverageRole) => ({
          role,
          state: 'missing',
          filledByProductId: null,
          filledByName: null,
          goalRelevance: 'supportive',
        })),
        filled: 0,
        total: 7,
      },
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'coverage_roles', passed: true }),
    );
  });

  it('does not consume a retinoid coverage slot as the peptide equivalent', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) =>
        candidate.id === 'refine_pregnancy_fine_lines_uk_retinoid_block',
    );
    if (!persona) throw new Error('Expected pregnancy fine-lines persona.');
    const generator = generatorForPersona(persona, {
      coverage: {
        slots: [
          'cleanse',
          'moisturise',
          'spf',
          'retinoid',
          'antioxidant',
          'barrier-support',
          'recovery-mask',
        ].map((role: SmartPicksCoverageRole) => ({
          role,
          state: 'missing',
          filledByProductId: null,
          filledByName: null,
          goalRelevance: 'supportive',
        })),
        filled: 0,
        total: 7,
      },
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'coverage_roles', passed: true }),
    );
  });

  it('keeps retinoid missing when only a peptide-like coverage role is present', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) =>
        candidate.id === 'refine_pregnancy_fine_lines_uk_retinoid_block',
    );
    if (!persona) throw new Error('Expected pregnancy fine-lines persona.');
    const generator = generatorForPersona(persona, {
      coverage: {
        slots: ['cleanse', 'moisturise', 'spf', 'barrier-support'].map(
          (role: SmartPicksCoverageRole) => ({
            role,
            state: 'missing',
            filledByProductId: null,
            filledByName: null,
            goalRelevance: 'supportive',
          }),
        ),
        filled: 0,
        total: 4,
      },
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });
    const coverageCheck = result.checks.find(
      (check) => check.id === 'coverage_roles',
    );

    expect(coverageCheck).toEqual(expect.objectContaining({ passed: false }));
    expect(coverageCheck?.actual).toContain('retinoid');
  });

  it('accepts live-model resurfacing and sunscreen synonyms in gap checks', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) =>
        candidate.id ===
        'refine_full_shelf_premium_tone_australia_optional_support',
    );
    if (!persona) throw new Error('Expected premium tone persona.');
    const generator = generatorForPersona(persona, {
      considerGaps: [
        gap(
          'gentle-antioxidant-serum-eg-vitamin-c-derivative-or-niacinamide-based-antioxidant',
          'consider',
        ),
        gap(
          'low-irritation-exfoliant-for-texture-eg-lactic-acid-pha-or-very-gentle-bha-used-sparingly',
          'consider',
        ),
      ],
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'consider_gaps', passed: true }),
    );
  });

  it('accepts fragrance-free sunscreen as the sensitive-skin sunscreen concept', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) =>
        candidate.id === 'starter_sensitive_hydration_sweden_safety_block',
    );
    if (!persona) throw new Error('Expected sensitive-skin persona.');
    const generator = generatorForPersona(persona, {
      priorityGaps: [
        gap('gentle-fragrance-free-hydrating-cleanser', 'priority'),
        gap('ceramide-rich-fragrance-free-moisturizer', 'priority'),
        gap(
          'broad-spectrum-spf-30-fragrance-free-sunscreen-with-low-white-cast',
          'priority',
        ),
      ],
      considerGaps: [],
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'priority_gaps', passed: true }),
    );
  });

  it('accepts specific acne-treatment actives as the breakout treatment concept', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) => candidate.id === 'starter_oily_congestion_drugstore_us',
    );
    if (!persona) throw new Error('Expected congestion starter persona.');
    const generator = generatorForPersona(persona, {
      priorityGaps: [
        gap('low-stripping-gentle-cleanser', 'priority'),
        gap('barrier-support-moisturizer', 'priority'),
        gap('sensitive-skin-sunscreen', 'priority'),
        gap('salicylic-acid-bha-acne-treatment', 'priority'),
      ],
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'priority_gaps', passed: true }),
    );
  });

  it('accepts replacement and recovery wording that names the exact shelf problem', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) =>
        candidate.id ===
        'refine_reactive_barrier_france_irritation_replacement',
    );
    if (!persona) throw new Error('Expected reactive barrier persona.');
    const generator = generatorForPersona(persona, {
      priorityGaps: [
        gap('replacement-for-glycolic-night-toner', 'priority'),
        gap(
          'barrier-repair-moisturizer-or-cream-ceramides-cholesterol-fatty-acids-fragrance-free',
          'priority',
        ),
      ],
      considerGaps: [
        gap(
          'gentle-soothing-serum-panthenol-centella-allantoin-beta-glucan',
          'consider',
        ),
      ],
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'priority_gaps', passed: true }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'consider_gaps', passed: true }),
    );
  });

  it('accepts specific tone support roles as goal-primary coverage', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) =>
        candidate.id === 'refine_replacement_history_not_improving_us',
    );
    if (!persona) throw new Error('Expected replacement history persona.');
    const generator = generatorForPersona(persona, {
      coverage: {
        slots: [
          'spf',
          'dark-spot-treatment',
          'antioxidant',
          'exfoliation-mask',
        ].map((role: SmartPicksCoverageRole) => ({
          role,
          state: 'missing',
          filledByProductId: null,
          filledByName: null,
          goalRelevance: 'supportive',
        })),
        filled: 0,
        total: 4,
      },
    });

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'coverage_roles', passed: true }),
    );
  });

  it('retries missing product picks during live-model evaluation', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS[0];
    const allKeys = [
      ...persona.expected.priorityGapKeys,
      ...requiredConsiderGapKeys(persona),
    ];
    const generator = generatorForPersona(persona);
    jest
      .mocked(generator.generateWithDiagnostics)
      .mockResolvedValueOnce(generationResult(allKeys.slice(0, -1)))
      .mockResolvedValueOnce(generationResult([allKeys[allKeys.length - 1]]));

    const result = await evaluateSmartPicksPersona({ persona, generator });

    expect(result.status).toBe('passed');
    expect(generator.generateWithDiagnostics).toHaveBeenCalledTimes(2);
    expect(generator.generateWithDiagnostics).toHaveBeenLastCalledWith(
      expect.any(Object),
      [expect.objectContaining({ normalizedKey: allKeys[allKeys.length - 1] })],
    );
  });

  it('treats fewer blocked unsafe AI suggestions as acceptable', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) =>
        candidate.id === 'starter_sensitive_hydration_sweden_safety_block',
    );
    if (!persona) throw new Error('Expected sensitive-skin persona.');
    const generator = generatorForPersona(persona);
    jest.mocked(generator.generatePlanWithDiagnostics).mockResolvedValueOnce(
      planResult({
        coverage: {
          slots: persona.expected.coverageRoles.map((role) => ({
            role,
            state: 'missing',
            filledByProductId: null,
            filledByName: null,
            goalRelevance: 'essential',
          })),
          filled: 0,
          total: persona.expected.coverageRoles.length,
        },
        priorityGaps: persona.expected.priorityGapKeys.map((key) =>
          gap(key, 'priority'),
        ),
        considerGaps: [],
      }),
    );

    const result = await evaluateSmartPicksPersona({
      persona,
      generator,
      includeProductPicks: false,
    });

    expect(result.status).toBe('passed');
    expect(
      result.checks.find((check) => check.id === 'blocked_safety_count'),
    ).toEqual(expect.objectContaining({ passed: true }));
  });

  it('keeps blocked unbacked replacement attempts as guardrail diagnostics, not failed output', async () => {
    const persona = SMART_PICKS_GOLDEN_PERSONAS.find(
      (candidate) =>
        candidate.id === 'refine_pregnancy_fine_lines_uk_retinoid_block',
    );
    if (!persona) throw new Error('Expected pregnancy fine-lines persona.');
    const generator = generatorForPersona(persona);
    const basePlan = planResult({
      coverage: {
        slots: persona.expected.coverageRoles.map((role) => ({
          role,
          state: 'missing',
          filledByProductId: null,
          filledByName: null,
          goalRelevance: 'supportive',
        })),
        filled: 0,
        total: persona.expected.coverageRoles.length,
      },
      priorityGaps: [],
      considerGaps: persona.expected.considerGapKeys.map((key) =>
        gap(key, 'consider'),
      ),
    });
    jest.mocked(generator.generatePlanWithDiagnostics).mockResolvedValueOnce({
      ...basePlan,
      diagnostics: {
        ...basePlan.diagnostics,
        blockedReplacementEvidenceGapCount: 1,
      },
    });

    const result = await evaluateSmartPicksPersona({
      persona,
      generator,
      includeProductPicks: false,
    });

    expect(result.status).toBe('passed');
    expect(
      result.checks.find(
        (check) => check.id === 'blocked_replacement_evidence_count',
      ),
    ).toEqual(expect.objectContaining({ passed: true, actual: '1' }));
  });

  it('builds a drift hash from sanitized output summaries', () => {
    const report = buildSmartPicksEvaluationReport({
      model: 'gpt-test',
      promptVersion: 'smart-picks-eval-v1',
      generatedAt: new Date('2026-05-14T08:00:00.000Z'),
      results: [
        {
          id: 'case-1',
          mode: 'starter',
          countryCode: 'CA',
          budgetTier: 'premium',
          primaryGoal: 'test goal',
          status: 'passed',
          score: 1,
          checks: [],
          planDiagnostics: planResult().diagnostics,
          productDiagnostics: generationResult().diagnostics,
          coverageRoles: ['cleanse'],
          priorityGapKeys: ['cleanser'],
          considerGapKeys: [],
          productPicks: [
            {
              normalizedKey: 'cleanser',
              brand: 'Brand',
              productName: 'Cleanser',
              budgetTier: 'premium',
              sellerNameCount: 1,
              alternativeCount: 0,
              recommendationRankReason: 'Good fit.',
            },
          ],
          manualReviewChecklist: ['Review product fit.'],
        },
      ],
    });

    expect(report).toEqual(
      expect.objectContaining({
        totalCases: 1,
        passedCases: 1,
        driftHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('builds a complete synthetic context for live-model evaluation', () => {
    const context = buildGoldenSmartPicksContext(
      SMART_PICKS_GOLDEN_PERSONAS[0],
    );

    expect(context.skinProfileRequired).toBe(false);
    expect(context.consentRequired).toBe(false);
    expect(context.skinProfile?.allow_smart_picks).toBe(true);
    expect(context.budgetTier).toBe(SMART_PICKS_GOLDEN_PERSONAS[0].budgetTier);
  });
});

function generatorForPersona(
  persona: (typeof SMART_PICKS_GOLDEN_PERSONAS)[number],
  overrides: Partial<
    NonNullable<SmartPicksAiPlanGenerationResult['plan']>
  > = {},
): SmartPicksEvaluationGenerator {
  const considerGapKeys = requiredConsiderGapKeys(persona);
  const productKeys = [...persona.expected.priorityGapKeys, ...considerGapKeys];
  return {
    generatePlanWithDiagnostics: jest.fn().mockResolvedValue(
      planResult({
        coverage: {
          slots: persona.expected.coverageRoles.map((role) => ({
            role,
            state: 'missing',
            filledByProductId: null,
            filledByName: null,
            goalRelevance: 'essential',
          })),
          filled: 0,
          total: persona.expected.coverageRoles.length,
        },
        priorityGaps: persona.expected.priorityGapKeys.map((key) =>
          gap(key, 'priority'),
        ),
        considerGaps: considerGapKeys.map((key) => gap(key, 'consider')),
        ...overrides,
      }),
    ),
    generateWithDiagnostics: jest
      .fn()
      .mockResolvedValue(generationResult(productKeys)),
  };
}

function requiredConsiderGapKeys(
  persona: (typeof SMART_PICKS_GOLDEN_PERSONAS)[number],
): string[] {
  const keys: string[] = [...persona.expected.considerGapKeys];
  const minimum = expectedMinimumConsiderGapCount(persona);
  while (keys.length < minimum) {
    keys.push(`review-consider-${keys.length + 1}`);
  }
  return keys;
}

function expectedMinimumConsiderGapCount(
  persona: (typeof SMART_PICKS_GOLDEN_PERSONAS)[number],
): number {
  return 'minimumConsiderGapCount' in persona.expected
    ? persona.expected.minimumConsiderGapCount
    : persona.expected.considerGapKeys.length;
}

function planResult(
  plan: SmartPicksAiPlanGenerationResult['plan'] = {
    coverage: { slots: [], filled: 0, total: 0 },
    priorityGaps: [],
    considerGaps: [],
  },
): SmartPicksAiPlanGenerationResult {
  return {
    plan,
    diagnostics: {
      rawCoverageSlotCount: plan?.coverage.slots.length ?? 0,
      acceptedCoverageSlotCount: plan?.coverage.slots.length ?? 0,
      invalidCoverageSlotCount: 0,
      rawGapCount:
        (plan?.priorityGaps.length ?? 0) + (plan?.considerGaps.length ?? 0),
      acceptedGapCount:
        (plan?.priorityGaps.length ?? 0) + (plan?.considerGaps.length ?? 0),
      acceptedPriorityGapCount: plan?.priorityGaps.length ?? 0,
      acceptedConsiderGapCount: plan?.considerGaps.length ?? 0,
      invalidGapCount: 0,
      blockedOwnedGapCount: 0,
      blockedSafetyGapCount: 0,
      blockedPregnancySafetyGapCount: 0,
      blockedReplacementEvidenceGapCount: 0,
      providerFailed: false,
      providerSkippedReason: null,
      missingPlan: false,
    },
  };
}

function generationResult(
  keys: readonly string[] = [],
): SmartPicksAiGenerationResult {
  return {
    picks: new Map(
      keys.map((key) => [
        key,
        {
          brand: 'Review Brand',
          productName: `Review ${key}`,
          budgetTier: 'premium',
          sellerNames: ['Brand site'],
          reasoningChips: [],
          reasoningFacts: {},
          ruledOut: [],
          alternatives: [],
          sourceIds: [],
          recommendationRankReason: 'Matches the requested gap.',
        },
      ]),
    ),
    diagnostics: {
      requestedGapCount: keys.length,
      rawGapCount: keys.length,
      acceptedPickCount: keys.length,
      blockedOwnedCount: 0,
      blockedBudgetCount: 0,
      blockedSafetyCount: 0,
      invalidPickCount: 0,
      missingPickCount: 0,
      providerFailed: false,
      providerSkippedReason: null,
    },
  };
}

function gap(normalizedKey: string, priority: 'priority' | 'consider') {
  return {
    ingredientOrCategory: normalizedKey,
    normalizedKey,
    priority,
    reason: 'Needed for this persona.',
    shortReason: 'Needed.',
    goalAlignment: 'goal support',
    sourceIds: [],
    gapKind: SmartPicksGapKind.GoalSupport,
    replacementFor: null,
  };
}
