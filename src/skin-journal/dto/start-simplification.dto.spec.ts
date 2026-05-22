import { validate } from 'class-validator';
import { StartSimplificationDto } from './start-simplification.dto';

describe('StartSimplificationDto', () => {
  it('rejects non-string simplification reasons', async () => {
    const dto = Object.assign(new StartSimplificationDto(), {
      reason: { unsafe: true },
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'reason',
        }),
      ]),
    );
  });

  it('allows an omitted trigger event id for user-initiated simplification', async () => {
    const dto = Object.assign(new StartSimplificationDto(), {
      reason: 'User noticed possible irritation.',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
