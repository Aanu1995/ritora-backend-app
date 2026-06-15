import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SuggestionProductScore } from '../suggestion-context.types';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionStep } from '../entities/suggestion-step.entity';
import { SuggestionInstanceResponseDto } from './suggestion-instance-response.dto';

describe('SuggestionInstanceResponseDto', () => {
  it('shows product data warnings only for products used in the suggestion', () => {
    const dto = SuggestionInstanceResponseDto.fromEntity(
      suggestion({
        productScores: [
          productScore({
            productId: 'cleanser-1',
            brand: 'CeraVe',
            name: 'Hydrating Cleanser',
            dataQuality: 'verified',
            dataQualityWarnings: [],
          }),
          productScore({
            productId: 'unused-product-1',
            brand: 'Ritora Lab',
            name: 'Unused Treatment',
            category: ProductCategory.Treatment,
            dataQuality: 'insufficient',
            dataQualityWarnings: ['ingredient list missing'],
          }),
        ],
        steps: [
          suggestionStep({
            productId: 'cleanser-1',
            brand: 'CeraVe',
            name: 'Hydrating Cleanser',
            ingredients: ['Aqua', 'Glycerin'],
          }),
        ],
      }),
    );

    expect(dto.productDataQuality).toEqual({
      verifiedCount: 1,
      partialCount: 0,
      insufficientCount: 0,
      warnings: [],
    });
  });

  it('names the affected product when a suggested product has limited data', () => {
    const dto = SuggestionInstanceResponseDto.fromEntity(
      suggestion({
        productScores: [
          productScore({
            productId: 'treatment-1',
            brand: 'Ritora Lab',
            name: 'Evening Treatment',
            category: ProductCategory.Treatment,
            dataQuality: 'insufficient',
            dataQualityWarnings: ['ingredient list missing'],
          }),
        ],
        steps: [
          suggestionStep({
            productId: 'treatment-1',
            brand: 'Ritora Lab',
            name: 'Evening Treatment',
            ingredients: [],
          }),
        ],
      }),
    );

    expect(dto.productDataQuality.warnings).toEqual([
      'Ritora Lab Evening Treatment: ingredient list missing',
    ]);
  });

  it('does not keep a stale ingredient-missing warning when the live suggested product has ingredients', () => {
    const dto = SuggestionInstanceResponseDto.fromEntity(
      suggestion({
        productScores: [
          productScore({
            productId: 'serum-1',
            brand: 'The Ordinary',
            name: 'Niacinamide 10% + Zinc 1%',
            dataQuality: 'insufficient',
            dataQualityWarnings: ['ingredient list missing'],
          }),
        ],
        steps: [
          suggestionStep({
            productId: 'serum-1',
            brand: 'The Ordinary',
            name: 'Niacinamide 10% + Zinc 1%',
            ingredients: ['Aqua', 'Niacinamide', 'Zinc PCA'],
          }),
        ],
      }),
    );

    expect(dto.productDataQuality.warnings).toEqual([]);
  });
});

function suggestion(input: {
  productScores: SuggestionProductScore[];
  steps: SuggestionStep[];
}): SuggestionInstance {
  const now = new Date('2026-06-15T19:00:00.000Z');
  return {
    id: 'suggestion-1',
    user_id: 'user-1',
    slot_id: null,
    request_source: 'on_demand',
    request_context: null,
    target_date: '2026-06-15',
    target_time: '20:56',
    daypart: 'evening',
    mode: 'ai',
    generation_status: 'ready',
    visible_at: now,
    generated_at: now,
    ai_model: 'test-model',
    ai_prompt_version: 'test-prompt',
    has_reaction_signal: false,
    simplified_for_reaction: false,
    ai_explanation: null,
    gap_recommendations: [],
    safety_flags: [],
    generation_context: {
      productScores: input.productScores,
    },
    steps: input.steps,
    created_at: now,
    updated_at: now,
  } as unknown as SuggestionInstance;
}

function suggestionStep(input: {
  productId: string;
  brand: string;
  name: string;
  ingredients: string[];
}): SuggestionStep {
  return {
    id: `step-${input.productId}`,
    step_order: 0,
    routine_step_id: null,
    inventory_product_id: input.productId,
    product_brand_snapshot: input.brand,
    product_name_snapshot: input.name,
    step_label: ProductCategory.Serum,
    custom_label: null,
    application_method: null,
    quantity: null,
    wait_after_minutes: null,
    explanation: null,
    routine_note_snapshot: null,
    provenance: 'ai_added',
    chips: [],
    safety_warnings: [],
    product: {
      id: input.productId,
      brand: input.brand,
      name: input.name,
      category: ProductCategory.Serum,
      status: ShelfStatus.Active,
      identity: {
        inciIngredients: input.ingredients,
        imageUrls: [],
      },
    },
  } as unknown as SuggestionStep;
}

function productScore(
  overrides: Partial<SuggestionProductScore>,
): SuggestionProductScore {
  return {
    productId: 'product-1',
    brand: 'Brand',
    name: 'Product',
    category: ProductCategory.Serum,
    preferredTimeOfDay: null,
    activeTags: [],
    suitabilityScore: 60,
    suitabilityReasons: [],
    cautionReasons: [],
    waitMinutes: null,
    inciQuality: 'available',
    dataQuality: 'verified',
    dataQualityWarnings: [],
    evidenceSourceIds: [],
    ...overrides,
  };
}
