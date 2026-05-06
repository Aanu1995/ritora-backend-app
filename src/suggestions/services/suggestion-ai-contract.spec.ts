import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import {
  SuggestionContextSummary,
  SuggestionProductScore,
} from '../suggestion-context.types';
import { SuggestionEvidenceSourceId } from '../suggestions.constants';
import { SuggestionGenerationInputs } from './suggestion-ai-generator';
import {
  buildPrompt,
  defaultExplanation,
  estimateCost,
  extractOutputText,
  RESPONSE_FORMAT,
  SYSTEM_PROMPT,
} from './suggestion-ai-contract';
import { getSuggestionEvidenceSources } from './suggestion-evidence-sources';

describe('suggestion AI contract', () => {
  it('requires trusted source ids in structured safety and gap output', () => {
    const schema = RESPONSE_FORMAT.schema.properties;

    expect(SYSTEM_PROMPT).toContain('trusted evidence summaries');
    expect(schema.safetyFlags.items.required).toContain('sourceIds');
    expect(schema.gapRecommendations.items.required).toContain('sourceIds');
    expect(
      schema.steps.items.properties.safetyWarnings.items.required,
    ).toContain('sourceIds');
  });

  it('includes minimized trusted evidence and scored product context in the prompt', () => {
    const prompt = buildPrompt(generationInputs());

    expect(prompt).toContain('Trusted evidence summaries');
    expect(prompt).toContain(SuggestionEvidenceSourceId.AadSunscreenSelection);
    expect(prompt).toContain('Daily SPF 50');
    expect(prompt).toContain('productScores');
    expect(prompt).not.toContain('data:image');
  });

  it('extracts structured output text, rejects refusals, and estimates model cost', () => {
    expect(
      extractOutputText({
        output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }],
      }),
    ).toBe('{"ok":true}');
    expect(
      extractOutputText({
        output: [{ content: [{ type: 'refusal', refusal: 'no' }] }],
      }),
    ).toBeNull();
    expect(estimateCost({ input_tokens: 1000, output_tokens: 500 })).toBe(
      0.00045,
    );
    expect(defaultExplanation()).toEqual({
      headline: '',
      body: [],
      perStepReasons: [],
      skipped: [],
      inputs: [],
    });
  });
});

function generationInputs(): SuggestionGenerationInputs {
  const product = sunscreenProduct();
  return {
    slotId: 'slot-1',
    targetDate: '2026-05-04',
    targetTime: '08:00',
    daypart: 'morning',
    skinProfile: null,
    shelfActiveProducts: [product],
    shelfFinishedProductIds: [],
    routineSteps: [],
    recentJournalEntries: [],
    recentApplications: [],
    aiPersonalizationAllowed: true,
    aiPersonalizationBlockedReason: null,
    contextSummary: contextSummary(product),
  };
}

function contextSummary(product: InventoryProduct): SuggestionContextSummary {
  const productScore: SuggestionProductScore = {
    productId: product.id,
    brand: product.brand,
    name: product.name,
    category: product.category,
    preferredTimeOfDay: 'morning',
    activeTags: ['spf'],
    suitabilityScore: 90,
    suitabilityReasons: ['daytime sun protection fit'],
    cautionReasons: [],
    waitMinutes: null,
    inciQuality: 'available',
    dataQuality: 'verified',
    dataQualityWarnings: [],
    evidenceSourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
  };
  return {
    cacheKey: 'ctx',
    builtAt: '2026-05-04T06:00:00.000Z',
    targetDate: '2026-05-04',
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
    routineBreak: {
      recentlyResumed: false,
      lastPausedFrom: null,
      lastPausedUntil: null,
    },
    productScores: [productScore],
    applicationPatterns: {
      days: 0,
      skippedByCategory: {},
      substitutedByCategory: {},
      addedOffShelfCount: 0,
      editedLogCount: 0,
      adherenceByCategory: {},
    },
    safetyConstraints: ['daytime_spf_available'],
    governance: {
      safetyPolicyVersion: 'test-policy',
      safetyPolicyReviewedAt: '2026-05-04',
      aiPersonalizationAllowed: true,
      aiPersonalizationBlockedReason: null,
    },
    evidenceSources: getSuggestionEvidenceSources(
      productScore.evidenceSourceIds,
    ),
    skippedCandidates: [],
  };
}

function sunscreenProduct(): InventoryProduct {
  return {
    id: 'spf-1',
    brand: 'North Sun',
    name: 'Daily SPF 50',
    category: ProductCategory.SunProtection,
    status: ShelfStatus.Active,
    guidance: {
      waitMinutes: null,
      cautions: [],
    },
    identity: {
      inciIngredients: ['Zinc Oxide'],
    },
  } as unknown as InventoryProduct;
}
