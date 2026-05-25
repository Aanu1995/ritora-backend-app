import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import {
  ApplicationMethod,
  ProductCategory,
  Quantity,
  ShelfStatus,
} from '../../shelf/shelf.types';
import { SuggestionContextSummary } from '../suggestion-context.types';
import {
  buildAssemblyContext,
  isAllSpecialistLocked,
  lockedStepsAreIntact,
  resolveRawStep,
  routineStepToOutput,
  sanitizeExplanation,
  sanitizeGapRecommendations,
} from './suggestion-ai-assembly';
import { SuggestionGenerationInputs } from './suggestion-ai-generator';

describe('suggestion AI assembly validation', () => {
  it('requires specialist-locked steps to remain present and ordered', () => {
    const inputs = generationInputs([routineStep('step-1', true)]);

    expect(
      lockedStepsAreIntact(inputs, [
        {
          stepOrder: 0,
          routineStepId: 'step-1',
          inventoryProductId: 'product-1',
          stepLabel: ProductCategory.Cleanser,
          provenance: 'specialist_locked',
        },
      ]),
    ).toBe(true);
    expect(lockedStepsAreIntact(inputs, [])).toBe(false);
  });

  it('rejects AI-added steps that invent products outside the active shelf', () => {
    const context = buildAssemblyContext(generationInputs([]));

    const resolved = resolveRawStep(
      {
        stepOrder: 0,
        inventoryProductId: 'missing-product',
        productBrand: 'Made Up',
        productName: 'Serum',
        stepLabel: ProductCategory.Serum,
        provenance: 'ai_added',
      },
      0,
      context,
    );

    expect(resolved).toBeNull();
  });

  it('keeps generated copy short and converts verbose guidance to human labels', () => {
    const inputs = generationInputs([]);
    inputs.shelfActiveProducts = [productWithVerboseGuidance()];
    const context = buildAssemblyContext(inputs);

    const resolved = resolveRawStep(
      {
        stepOrder: 0,
        inventoryProductId: 'product-1',
        stepLabel: ProductCategory.Cleanser,
        provenance: 'ai_added',
        explanation:
          'This will treat the skin concern with a very long explanation that should not appear as a dense paragraph in the UI because users need short guidance.',
        chips: [{ tone: 'reason', text: 'A very long badge label for UI' }],
      },
      0,
      context,
    );

    expect(resolved).toEqual(
      expect.objectContaining({
        applicationMethod: 'As directed',
        quantity: 'As needed',
      }),
    );
    expect(resolved?.explanation).not.toContain('treat');
    expect(resolved?.explanation?.length).toBeLessThanOrEqual(140);
    expect(resolved?.chips[0].text.length).toBeLessThanOrEqual(32);
  });

  it('localizes deterministic guidance labels for Swedish suggestions', () => {
    const inputs = generationInputs([]);
    inputs.language = 'sv';
    inputs.shelfActiveProducts = [
      {
        ...product(),
        guidance: {
          applicationMethod: ApplicationMethod.CottonPad,
          quantity: Quantity.PeaSize,
        },
      } as InventoryProduct,
    ];
    const context = buildAssemblyContext(inputs);

    const resolved = resolveRawStep(
      {
        stepOrder: 0,
        inventoryProductId: 'product-1',
        stepLabel: ProductCategory.Cleanser,
        provenance: 'ai_added',
      },
      0,
      context,
    );

    expect(resolved).toEqual(
      expect.objectContaining({
        applicationMethod: 'Bomullsrondell',
        quantity: 'En arta',
      }),
    );
  });

  it('sanitizes explanation copy into concise user-facing text', () => {
    const explanation = sanitizeExplanation({
      headline: 'Diagnose and prescribe a very detailed routine for today',
      body: [
        'This paragraph is intentionally verbose and includes too much detail for a routine card. It should keep only the first sentence.',
      ],
      perStepReasons: [
        {
          stepOrder: 0,
          reason:
            'Treat the concern with a careful routine because this step has many possible benefits and constraints that would make the card hard to scan.',
        },
      ],
      skipped: [
        {
          name: 'Retinoid',
          reason:
            'Skipped because the recent journal suggests dryness and this explanation is longer than it needs to be.',
        },
      ],
      inputs: [
        {
          label: 'Recommendation analysis context',
          detail:
            'This used shelf, profile, schedule, recent logs, edited history, and journal observations.',
        },
      ],
    });

    expect(explanation.headline).toContain('assess');
    expect(explanation.headline).toContain('recommend');
    expect(explanation.headline).not.toContain('Diagnose');
    expect(explanation.headline).not.toContain('prescribe');
    expect(explanation.body[0]).toBe(
      'This paragraph is intentionally verbose and includes too much detail for a routine card.',
    );
    expect(explanation.perStepReasons[0].reason).not.toContain('Treat');
    expect(explanation.perStepReasons[0].reason.length).toBeLessThanOrEqual(
      140,
    );
    expect(explanation.inputs[0].label.length).toBeLessThanOrEqual(40);
  });

  it('drops no-op gap recommendations instead of showing a fake gap', () => {
    expect(
      sanitizeGapRecommendations([
        {
          ingredientOrCategory: 'none',
          reason: 'No missing products for this slot.',
          budgetTier: null,
          goalAlignment: null,
          sourceIds: [],
        },
      ]),
    ).toEqual([]);
  });

  it('keeps specialist-locked steps at their original routine order', () => {
    const context = buildAssemblyContext(
      generationInputs([routineStep('step-1', true)]),
    );

    const resolved = resolveRawStep(
      {
        stepOrder: 99,
        routineStepId: 'step-1',
        inventoryProductId: 'product-1',
        stepLabel: ProductCategory.Cleanser,
        provenance: 'specialist_locked',
      },
      0,
      context,
    );

    expect(resolved).toEqual(
      expect.objectContaining({
        routineStepId: 'step-1',
        stepOrder: 0,
        provenance: 'specialist_locked',
      }),
    );
  });

  it('preserves routine step notes as step-level context snapshots', () => {
    const specialistStep = routineStep(
      'step-1',
      true,
      'Use a rice-grain amount only on dry skin.',
    );
    const userStep = routineStep(
      'step-2',
      false,
      'Apply this only after the hydrating toner.',
    );
    const context = buildAssemblyContext(generationInputs([userStep]));

    expect(routineStepToOutput(specialistStep, 0)).toEqual(
      expect.objectContaining({
        routineNote: 'Use a rice-grain amount only on dry skin.',
      }),
    );

    expect(
      resolveRawStep(
        {
          stepOrder: 1,
          routineStepId: 'step-2',
          inventoryProductId: 'product-1',
          stepLabel: ProductCategory.Cleanser,
          provenance: 'user_routine',
        },
        1,
        context,
      ),
    ).toEqual(
      expect.objectContaining({
        routineNote: 'Apply this only after the hydrating toner.',
      }),
    );
  });

  it('marks all-specialist slots as deterministic baseline candidates', () => {
    expect(
      isAllSpecialistLocked(generationInputs([routineStep('step-1', true)])),
    ).toBe(true);
    expect(
      isAllSpecialistLocked(
        generationInputs([
          routineStep('step-1', true),
          routineStep('step-2', false),
        ]),
      ),
    ).toBe(false);
  });
});

function generationInputs(
  routineSteps: RoutineStep[],
): SuggestionGenerationInputs {
  return {
    slotId: 'slot-1',
    requestSource: 'scheduled',
    requestContext: null,
    targetDate: '2026-04-29',
    targetTime: '08:00',
    daypart: 'morning',
    skinProfile: null,
    shelfActiveProducts: [product()],
    shelfFinishedProductIds: ['finished-1'],
    routineSteps,
    recentJournalEntries: [],
    recentApplications: [],
    aiPersonalizationAllowed: true,
    aiPersonalizationBlockedReason: null,
    environmentSnapshotId: null,
    contextSummary: contextSummary(),
  };
}

function contextSummary(): SuggestionContextSummary {
  return {
    cacheKey: 'test',
    builtAt: '2026-04-29T06:00:00.000Z',
    targetDate: '2026-04-29',
    targetTime: '08:00',
    daypart: 'morning',
    requestSource: 'scheduled',
    onDemand: null,
    environment: null,
    skinProfile: {
      primaryGoal: null,
      skinType: null,
      sensitivityLevel: null,
      activeConcerns: [],
      pregnancyStatus: null,
    },
    reaction: {
      hasSignal: false,
      severity: null,
      confidence: null,
      indicators: [],
      affectedZones: [],
      concernKeys: [],
      daysSinceLatestSignal: null,
      barrierCompromised: false,
      photoInputImages: 0,
      multiAnglePhotoEntries: 0,
    },
    routineBreak: {
      recentlyResumed: false,
      lastPausedFrom: null,
      lastPausedUntil: null,
    },
    productScores: [],
    applicationPatterns: {
      days: 0,
      daysSinceLastApplication: null,
      conservativeRestart: false,
      skippedByCategory: {},
      substitutedByCategory: {},
      addedOffShelfCount: 0,
      editedLogCount: 0,
      adherenceByCategory: {},
    },
    safetyConstraints: [],
    governance: {
      safetyPolicyVersion: 'test-policy',
      safetyPolicyReviewedAt: '2026-05-04',
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
    evidenceSources: [],
    skippedCandidates: [],
  };
}

function product(): InventoryProduct {
  return {
    id: 'product-1',
    user_id: 'user-1',
    brand: 'Ava Lab',
    name: 'Gentle Cleanser',
    category: ProductCategory.Cleanser,
    status: ShelfStatus.Active,
    guidance: {},
  } as InventoryProduct;
}

function productWithVerboseGuidance(): InventoryProduct {
  return {
    ...product(),
    guidance: {
      applicationMethod:
        'apply by massaging slowly across every facial zone until fully absorbed',
      quantity:
        'use a flexible amount based on how dry the skin feels in the moment',
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
  } as unknown as InventoryProduct;
}

function routineStep(
  id: string,
  isSpecialistLocked: boolean,
  notes: string | null = null,
): RoutineStep {
  return {
    id,
    step_order: id.endsWith('2') ? 1 : 0,
    inventory_product_id: 'product-1',
    step_label: ProductCategory.Cleanser,
    custom_label: null,
    notes,
    is_specialist_locked: isSpecialistLocked,
    product: product(),
  } as RoutineStep;
}
