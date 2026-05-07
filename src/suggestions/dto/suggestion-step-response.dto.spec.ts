import { SuggestionStep } from '../entities/suggestion-step.entity';
import { SuggestionStepResponseDto } from './suggestion-step-response.dto';

describe('SuggestionStepResponseDto', () => {
  it('uses stored product snapshots before live product names', () => {
    const dto = SuggestionStepResponseDto.fromEntity({
      id: 'step-1',
      step_order: 0,
      routine_step_id: null,
      inventory_product_id: 'product-1',
      product_brand_snapshot: 'Original Brand',
      product_name_snapshot: 'Original Serum',
      step_label: 'serum',
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
        id: 'product-1',
        brand: 'Edited Brand',
        name: 'Edited Serum',
        category: 'serum',
        status: 'active',
        identity: { imageUrls: [] },
      },
    } as unknown as SuggestionStep);

    expect(dto.productBrand).toBe('Original Brand');
    expect(dto.productName).toBe('Original Serum');
    expect(dto.product).toEqual(
      expect.objectContaining({
        brand: 'Edited Brand',
        name: 'Edited Serum',
      }),
    );
  });
});
