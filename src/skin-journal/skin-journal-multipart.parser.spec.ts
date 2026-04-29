import { BadRequestException } from '@nestjs/common';
import { normalizeUpsertEntryBody } from './skin-journal-multipart.parser';

describe('normalizeUpsertEntryBody', () => {
  it('normalizes multipart strings, arrays, ratings, and recent change payloads', () => {
    const result = normalizeUpsertEntryBody({
      is_pre_routine: 'true' as unknown as boolean,
      sweat_exercise_today: 'false' as unknown as boolean,
      skip_check_in: 'true' as unknown as boolean,
      photo_processing_consent: 'true' as unknown as boolean,
      concern_focus: '["redness","texture"]' as unknown as string[],
      ratings: '{"redness":"4","oiliness":2}' as unknown as never,
      recent_change:
        '{"kind":"started_new_product","related_inventory_product_id":"product-1","note":"Added serum"}' as unknown as never,
    });

    expect(result).toMatchObject({
      is_pre_routine: true,
      sweat_exercise_today: false,
      skip_check_in: true,
      photo_processing_consent: true,
      concern_focus: ['redness', 'texture'],
      ratings: { redness: 4, oiliness: 2 },
      recent_change: {
        kind: 'started_new_product',
        related_inventory_product_id: 'product-1',
        note: 'Added serum',
      },
    });
  });

  it('supports dotted and bracketed multipart rating keys', () => {
    const result = normalizeUpsertEntryBody({
      'ratings.redness': '5',
      'ratings[texture]': '3',
    } as never);

    expect(result.ratings).toEqual({ redness: 5, texture: 3 });
  });

  it('throws a bad request for malformed JSON payloads', () => {
    expect(() =>
      normalizeUpsertEntryBody({
        ratings: '{"redness":',
      } as never),
    ).toThrow(BadRequestException);
  });
});
