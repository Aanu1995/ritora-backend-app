import { ApplicationLogItem } from '../entities/application-log-item.entity';
import { ApplicationLogItemResponseDto } from './application-log-item.dto';

describe('ApplicationLogItemResponseDto', () => {
  it('resolves applied and substituted product images with the shelf media resolver', () => {
    const dto = ApplicationLogItemResponseDto.fromEntity(
      {
        id: 'item-1',
        step_order: 0,
        suggestion_step_id: 'step-1',
        inventory_product_id: 'product-1',
        substituted_with_product_id: 'product-2',
        product_brand_snapshot: 'Original Brand',
        product_name_snapshot: 'Original Product',
        step_label: 'serum',
        status: 'substituted',
        is_ad_hoc: false,
        item_source: 'recommended',
        ad_hoc_brand: null,
        ad_hoc_name: null,
        notes: null,
        substitution_reason: null,
        recommended_snapshot: null,
        applied_snapshot: null,
        applied_at: null,
        product: {
          id: 'product-1',
          brand: 'Original Brand',
          name: 'Original Product',
          category: 'serum',
          status: 'active',
          identity: {
            imageUrls: ['https://media.example.com/original.webp'],
          },
        },
        substituted_with_product: {
          id: 'product-2',
          brand: 'Replacement Brand',
          name: 'Replacement Product',
          category: 'moisturizer',
          status: 'active',
          identity: {
            imageUrls: ['https://media.example.com/replacement.webp'],
          },
        },
      } as unknown as ApplicationLogItem,
      {
        resolveProductImageUrls: (imageUrls) =>
          imageUrls.map((imageUrl) => `${imageUrl}?signed=true`),
      },
    );

    expect(dto.product?.imageUrl).toBe(
      'https://media.example.com/original.webp?signed=true',
    );
    expect(dto.substitutedWithProduct?.imageUrl).toBe(
      'https://media.example.com/replacement.webp?signed=true',
    );
  });
});
