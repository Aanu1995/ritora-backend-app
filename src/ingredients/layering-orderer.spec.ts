import { ProductCategory } from '../shelf/shelf.types';
import { buildLayeringOrder } from './layering-orderer';

describe('buildLayeringOrder localization', () => {
  it('returns deterministic layering reasons in Spanish', () => {
    const [step] = buildLayeringOrder(
      [
        {
          id: 'cleanser-1',
          brand: 'Ritora',
          name: 'Gentle Cleanser',
          category: ProductCategory.Cleanser,
          inciIngredients: ['Aqua'],
        },
      ],
      [],
      'es',
    );

    expect(step.reason).toBe(
      'Empieza con el limpiador para retirar acumulación antes de los pasos que se dejan en la piel.',
    );
  });
});
