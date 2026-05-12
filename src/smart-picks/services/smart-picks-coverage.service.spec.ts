import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SmartPicksCoverageService } from './smart-picks-coverage.service';

describe('SmartPicksCoverageService', () => {
  const service = new SmartPicksCoverageService();

  it('marks essential empty routine roles as priority gaps', () => {
    const coverage = service.compute([], 'post-acne dark marks');

    expect(slotState(coverage, 'cleanse')).toBe('missing-priority');
    expect(slotState(coverage, 'moisturise')).toBe('missing-priority');
    expect(slotState(coverage, 'spf')).toBe('missing-priority');
    expect(slotState(coverage, 'treat')).toBe('missing-priority');
    expect(slotState(coverage, 'hydrate')).toBe('missing');
    expect(coverage.filled).toBe(0);
  });

  it('fills the first treatment slot and routes later actives to the secondary slot', () => {
    const coverage = service.compute(
      [
        product('cleanser-1', ProductCategory.Cleanser, 'Soft Cleanser'),
        product('serum-1', ProductCategory.Serum, 'Azelaic Serum'),
        product('exfoliant-1', ProductCategory.Exfoliant, 'PHA Polish'),
        product('cream-1', ProductCategory.Moisturizer, 'Barrier Cream'),
        product('spf-1', ProductCategory.SunProtection, 'Mineral SPF 50'),
      ],
      'texture',
    );

    expect(slotName(coverage, 'cleanse')).toBe('Test Brand Soft Cleanser');
    expect(slotName(coverage, 'treat')).toBe('Test Brand Azelaic Serum');
    expect(slotName(coverage, 'treatment-secondary')).toBe(
      'Test Brand PHA Polish',
    );
    expect(slotState(coverage, 'moisturise')).toBe('filled');
    expect(slotState(coverage, 'spf')).toBe('filled');
    expect(coverage.filled).toBe(5);
  });
});

type Coverage = ReturnType<SmartPicksCoverageService['compute']>;

function slotState(
  coverage: Coverage,
  role: Coverage['slots'][number]['role'],
): Coverage['slots'][number]['state'] {
  const slot = coverage.slots.find((candidate) => candidate.role === role);
  if (!slot) throw new Error(`Missing coverage slot ${role}`);
  return slot.state;
}

function slotName(
  coverage: Coverage,
  role: Coverage['slots'][number]['role'],
): string | null {
  const slot = coverage.slots.find((candidate) => candidate.role === role);
  if (!slot) throw new Error(`Missing coverage slot ${role}`);
  return slot.filledByName;
}

function product(
  id: string,
  category: ProductCategory,
  name: string,
): InventoryProduct {
  return {
    id,
    user_id: 'user-1',
    brand: 'Test Brand',
    name,
    category,
    status: ShelfStatus.Active,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    identity: { inciIngredients: [] },
  } as unknown as InventoryProduct;
}
