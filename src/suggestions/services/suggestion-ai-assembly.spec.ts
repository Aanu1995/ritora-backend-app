import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SuggestionContextSummary } from '../suggestion-context.types';
import {
  buildAssemblyContext,
  isAllSpecialistLocked,
  lockedStepsAreIntact,
  resolveRawStep,
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
    },
    productScores: [],
    applicationPatterns: {
      days: 0,
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

function routineStep(id: string, isSpecialistLocked: boolean): RoutineStep {
  return {
    id,
    step_order: id.endsWith('2') ? 1 : 0,
    inventory_product_id: 'product-1',
    step_label: ProductCategory.Cleanser,
    custom_label: null,
    is_specialist_locked: isSpecialistLocked,
    product: product(),
  } as RoutineStep;
}
