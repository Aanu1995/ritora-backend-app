import { getMetadataArgsStorage } from 'typeorm';
import { PushNotificationDelivery } from './push-notification-delivery.entity';

describe('PushNotificationDelivery entity', () => {
  it('encrypts stored provider payloads used for retry', () => {
    const payloadColumn = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === PushNotificationDelivery &&
        column.propertyName === 'push_payload',
    );

    expect(payloadColumn?.options.transformer).toBeDefined();
  });
});
