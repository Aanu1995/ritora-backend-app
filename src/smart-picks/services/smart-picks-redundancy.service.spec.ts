import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SmartPicksRedundancyService } from './smart-picks-redundancy.service';

describe('SmartPicksRedundancyService', () => {
  const service = new SmartPicksRedundancyService();

  it('groups products that repeat active ingredient signals and preserves a keep/finish order', () => {
    const groups = service.detect([
      product('retinal-1', 'Gentle Retinal Serum', 'retinal', '2026-05-01'),
      product('retinol-1', 'Renewing Retinol Cream', 'retinol', '2026-05-02'),
      product('bha-1', 'BHA Liquid', 'salicylic acid', '2026-05-03'),
    ]);

    expect(groups).toEqual([
      {
        activeTag: 'retinoid',
        hint: 'You have 2 products with retinoid signals. Finish one before adding another.',
        products: [
          {
            id: 'retinal-1',
            brand: 'Test Brand',
            name: 'Gentle Retinal Serum',
            recommendation: 'keep',
          },
          {
            id: 'retinol-1',
            brand: 'Test Brand',
            name: 'Renewing Retinol Cream',
            recommendation: 'finish-first',
          },
        ],
      },
    ]);
  });
});

function product(
  id: string,
  name: string,
  ingredient: string,
  date: string,
): InventoryProduct {
  return {
    id,
    user_id: 'user-1',
    brand: 'Test Brand',
    name,
    category: ProductCategory.Serum,
    status: ShelfStatus.Active,
    created_at: new Date(`${date}T00:00:00.000Z`),
    updated_at: new Date(`${date}T00:00:00.000Z`),
    identity: { inciIngredients: [ingredient] },
  } as unknown as InventoryProduct;
}
