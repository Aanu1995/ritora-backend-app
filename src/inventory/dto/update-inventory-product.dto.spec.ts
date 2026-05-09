import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateInventoryProductDto } from './update-inventory-product.dto';

const validationOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

describe('UpdateInventoryProductDto', () => {
  it('accepts image-only identity patches for product photo updates', async () => {
    const dto = plainToInstance(UpdateInventoryProductDto, {
      identity: {
        imageUrls: [
          'https://cdn.example.com/product-images/processed/photo.webp',
        ],
      },
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
  });

  it('still validates fields included in nested partial patches', async () => {
    const dto = plainToInstance(UpdateInventoryProductDto, {
      identity: {
        imageUrls: ['not-a-url'],
      },
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.children?.[0]?.property).toBe('imageUrls');
  });
});
