import { getMetadataArgsStorage } from 'typeorm';
import { PushNotificationSubscription } from './push-notification-subscription.entity';

describe('PushNotificationSubscription entity', () => {
  it('encrypts provider secrets and personal device metadata at rest', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === PushNotificationSubscription,
    );

    for (const propertyName of [
      'endpoint',
      'web_push_keys',
      'token',
      'user_agent',
    ]) {
      const column = columns.find(
        (candidate) => candidate.propertyName === propertyName,
      );

      expect(column?.options.transformer).toBeDefined();
    }
  });
});
