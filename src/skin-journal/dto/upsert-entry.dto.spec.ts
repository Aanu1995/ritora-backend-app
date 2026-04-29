import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertEntryDto } from './upsert-entry.dto';

describe('UpsertEntryDto', () => {
  it('transforms multipart string fields into typed values before validation', async () => {
    const dto = plainToInstance(UpsertEntryDto, {
      concern_focus: '["redness","texture"]',
      is_pre_routine: 'true',
      ratings: '{"redness":4,"oiliness":"2"}',
      sweat_exercise_today: 'false',
      recent_change:
        '{"kind":"started_new_product","related_inventory_product_id":"product-1","note":"Added serum"}',
      skip_check_in: 'true',
      photo_processing_consent: 'true',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
    expect(dto.concern_focus).toEqual(['redness', 'texture']);
    expect(dto.is_pre_routine).toBe(true);
    expect(dto.ratings).toMatchObject({ redness: 4, oiliness: 2 });
    expect(dto.sweat_exercise_today).toBe(false);
    expect(dto.recent_change).toMatchObject({
      kind: 'started_new_product',
      related_inventory_product_id: 'product-1',
      note: 'Added serum',
    });
    expect(dto.skip_check_in).toBe(true);
    expect(dto.photo_processing_consent).toBe(true);
  });

  it('rejects malformed multipart JSON payloads', async () => {
    const dto = plainToInstance(UpsertEntryDto, {
      ratings: '{"redness":',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'ratings',
        }),
      ]),
    );
  });
});
