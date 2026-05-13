import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SmartPicksCoverageService } from './smart-picks-coverage.service';

describe('SmartPicksCoverageService', () => {
  const service = new SmartPicksCoverageService();

  it('marks essential empty routine roles as priority gaps', () => {
    const coverage = service.compute([], 'post-acne dark marks');

    expect(slotState(coverage, 'spf')).toBe('missing-priority');
    expect(slotState(coverage, 'dark-spot-treatment')).toBe('missing-priority');
    expect(slotState(coverage, 'antioxidant')).toBe('missing');
    expect(slotState(coverage, 'exfoliation-mask')).toBe('missing');
    expect(coverage.slots.map((slot) => slot.role)).not.toContain('eye');
    expect(coverage.filled).toBe(0);
  });

  it('changes coverage slots when the goal changes', () => {
    const darkSpotCoverage = service.compute([], 'remove dark spots');
    const hydrationCoverage = service.compute([], 'keep skin hydrated');
    const customGoalCoverage = service.compute(
      [],
      'look less tired after long workdays',
    );

    expect(darkSpotCoverage.slots.map((slot) => slot.role)).toEqual([
      'spf',
      'dark-spot-treatment',
      'antioxidant',
      'exfoliation-mask',
      'moisturise',
      'cleanse',
    ]);
    expect(hydrationCoverage.slots.map((slot) => slot.role)).toEqual([
      'hydrate',
      'moisturise',
      'spf',
      'recovery-mask',
      'cleanse',
    ]);
    expect(customGoalCoverage.slots.map((slot) => slot.role)).toEqual([
      'goal-primary',
      'spf',
      'goal-support',
      'moisturise',
      'cleanse',
    ]);
    expect(slotState(customGoalCoverage, 'goal-primary')).toBe(
      'missing-priority',
    );
  });

  it('merges coverage slots for profiles with more than one goal signal', () => {
    const coverage = service.compute(
      [],
      'remove dark spots and keep skin hydrated',
    );

    expect(coverage.slots.map((slot) => slot.role)).toEqual([
      'spf',
      'dark-spot-treatment',
      'antioxidant',
      'exfoliation-mask',
      'moisturise',
      'cleanse',
      'hydrate',
      'recovery-mask',
    ]);
    expect(slotState(coverage, 'dark-spot-treatment')).toBe('missing-priority');
    expect(slotState(coverage, 'hydrate')).toBe('missing-priority');
    expect(slotState(coverage, 'spf')).toBe('missing-priority');
  });

  it('fills custom goal coverage only when a product text matches the goal', () => {
    const coverage = service.compute(
      [
        product('serum-1', ProductCategory.Serum, 'Tired Look Eye Serum', [
          'caffeine',
        ]),
        product('spf-1', ProductCategory.SunProtection, 'Daily SPF 50'),
      ],
      'look less tired after long workdays',
    );

    expect(slotName(coverage, 'goal-primary')).toBe(
      'Test Brand Tired Look Eye Serum',
    );
    expect(slotName(coverage, 'spf')).toBe('Test Brand Daily SPF 50');
  });

  it('fills dark-spot goal slots from specific product signals', () => {
    const coverage = service.compute(
      [
        product('spf-1', ProductCategory.SunProtection, 'Mineral SPF 50'),
        product('serum-1', ProductCategory.Serum, 'Azelaic Tone Serum', [
          'azelaic acid',
        ]),
        product('vitamin-c-1', ProductCategory.Serum, 'Vitamin C Glow Serum', [
          'ascorbic acid',
        ]),
      ],
      'remove dark spots',
    );

    expect(slotName(coverage, 'spf')).toBe('Test Brand Mineral SPF 50');
    expect(slotName(coverage, 'dark-spot-treatment')).toBe(
      'Test Brand Azelaic Tone Serum',
    );
    expect(slotName(coverage, 'antioxidant')).toBe(
      'Test Brand Vitamin C Glow Serum',
    );
    expect(slotState(coverage, 'exfoliation-mask')).toBe('missing');
  });

  it('fills the first treatment slot and routes later actives to the secondary slot', () => {
    const coverage = service.compute(
      [
        product('cleanser-1', ProductCategory.Cleanser, 'Soft Cleanser'),
        product('serum-1', ProductCategory.Serum, 'Retinal Smooth Serum', [
          'retinal',
        ]),
        product('exfoliant-1', ProductCategory.Exfoliant, 'PHA Polish'),
        product('cream-1', ProductCategory.Moisturizer, 'Barrier Cream'),
        product('spf-1', ProductCategory.SunProtection, 'Mineral SPF 50'),
      ],
      'texture',
    );

    expect(slotName(coverage, 'cleanse')).toBe('Test Brand Soft Cleanser');
    expect(slotName(coverage, 'retinoid')).toBe(
      'Test Brand Retinal Smooth Serum',
    );
    expect(slotName(coverage, 'texture-exfoliant')).toBe(
      'Test Brand PHA Polish',
    );
    expect(slotState(coverage, 'moisturise')).toBe('filled');
    expect(slotState(coverage, 'spf')).toBe('filled');
    expect(coverage.filled).toBe(5);
  });

  it('uses product text as a fallback when shelf category is too broad or wrong', () => {
    const coverage = service.compute(
      [
        product('spf-1', ProductCategory.Other, 'Relief Sun SPF 50 PA++++'),
        product('cream-1', ProductCategory.Other, 'Ceramide Barrier Cream'),
        product('wash-1', ProductCategory.Other, 'Low pH Gel Cleanser'),
      ],
      'simple hydration',
    );

    expect(slotName(coverage, 'spf')).toBe(
      'Test Brand Relief Sun SPF 50 PA++++',
    );
    expect(slotName(coverage, 'moisturise')).toBe(
      'Test Brand Ceramide Barrier Cream',
    );
    expect(slotName(coverage, 'cleanse')).toBe(
      'Test Brand Low pH Gel Cleanser',
    );
    expect(slotState(coverage, 'hydrate')).toBe('missing-priority');
  });

  it('routes hydrating serums to hydration instead of treating any serum as a treatment', () => {
    const coverage = service.compute(
      [
        product(
          'serum-1',
          ProductCategory.Serum,
          'Hyaluronic Hydration Serum',
          ['hyaluronic acid', 'glycerin'],
        ),
      ],
      'calm breakouts',
    );

    expect(slotState(coverage, 'acne-treatment')).toBe('missing-priority');
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
  inciIngredients: string[] = [],
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
    identity: { inciIngredients },
  } as unknown as InventoryProduct;
}
