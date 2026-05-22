import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertPushSubscriptionDto } from './push-notification-subscription.dto';

describe('UpsertPushSubscriptionDto', () => {
  it('rejects oversized web push subscription fields', async () => {
    const dto = plainToInstance(UpsertPushSubscriptionDto, {
      provider: 'web_push',
      platform: 'web',
      endpoint: 'https://push.example/'.concat('a'.repeat(2050)),
      keys: {
        p256dh: 'p'.repeat(256),
        auth: 'a'.repeat(256),
      },
    });

    const errors = await validate(dto, { whitelist: true });
    const properties = errors.map((error) => error.property);

    expect(properties).toContain('endpoint');
    expect(
      errors
        .find((error) => error.property === 'keys')
        ?.children?.map((child) => child.property),
    ).toEqual(expect.arrayContaining(['p256dh', 'auth']));
  });

  it('rejects oversized mobile tokens and device names', async () => {
    const dto = plainToInstance(UpsertPushSubscriptionDto, {
      provider: 'fcm',
      platform: 'android',
      token: 't'.repeat(4097),
      device_name: 'd'.repeat(121),
    });

    const errors = await validate(dto, { whitelist: true });
    const properties = errors.map((error) => error.property);

    expect(properties).toEqual(
      expect.arrayContaining(['token', 'device_name']),
    );
  });
});
