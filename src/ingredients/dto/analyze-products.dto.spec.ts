import { validate } from 'class-validator';
import { AnalyzeProductsDto } from './analyze-products.dto';

describe('AnalyzeProductsDto', () => {
  it('rejects product-id analysis requests with more than 30 products', async () => {
    const dto = Object.assign(new AnalyzeProductsDto(), {
      productIds: Array.from(
        { length: 31 },
        (_, index) => `01HWXYZ${String(index).padStart(19, '0')}`,
      ),
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'productIds',
        }),
      ]),
    );
  });
});
