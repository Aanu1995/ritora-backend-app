import {
  ProductCompareGoal,
  ProductCompareOutcome,
} from './product-compare.types';
import {
  productCompareSummaryForDuplicate,
  productCompareSummaryForOutcome,
  productCompareSummaryForShelfRoutineConflict,
} from './product-compare-summaries';

describe('product compare Spanish summaries', () => {
  it('localizes deterministic new-product outcomes', () => {
    expect(
      productCompareSummaryForOutcome(
        ProductCompareGoal.NewProductDecision,
        ProductCompareOutcome.ChooseAnchor,
        'Barrier Serum',
        'es',
      ),
    ).toBe('Barrier Serum parece la mejor opción para tu piel y rutina.');
  });

  it('localizes duplicate and routine-conflict summaries', () => {
    expect(
      productCompareSummaryForDuplicate(
        ProductCompareGoal.NewProductDecision,
        'es',
      ),
    ).toContain('producto que ya tienes');

    expect(productCompareSummaryForShelfRoutineConflict('es')).toContain(
      'posible conflicto de uso conjunto',
    );
  });
});
