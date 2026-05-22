import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSlotsDto } from './create-slots.dto';

describe('schedule DTO transforms', () => {
  it('accepts a blank optional specialist active date as null', async () => {
    const dto = plainToInstance(CreateSlotsDto, {
      daysOfWeek: ['mon'],
      slotTime: '08:00',
      mode: 'ai',
      specialistActiveSince: '',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
    expect(dto.specialistActiveSince).toBeNull();
  });

  it('still rejects malformed specialist active dates', async () => {
    const dto = plainToInstance(CreateSlotsDto, {
      daysOfWeek: ['mon'],
      slotTime: '08:00',
      mode: 'manual',
      specialistActiveSince: '05/07/2026',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'specialistActiveSince',
        }),
      ]),
    );
  });
});
