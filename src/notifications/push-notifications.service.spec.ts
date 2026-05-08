import webpush from 'web-push';
import { PushDeliveryStatusValue } from './entities/push-notification-delivery.entity';
import {
  PushPlatformValue,
  PushProviderValue,
} from './entities/push-notification-subscription.entity';
import { PushNotificationsService } from './push-notifications.service';

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
  },
  WebPushError: class WebPushError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

const repo = () => ({
  create: jest.fn((data) => data),
  count: jest.fn().mockResolvedValue(0),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn(async (data) => data),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
});

function config(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function webSubscription(overrides = {}) {
  return {
    id: 'sub-1',
    user_id: 'user-1',
    provider: PushProviderValue.WebPush,
    platform: PushPlatformValue.Web,
    endpoint: 'https://push.example/sub-1',
    endpoint_hash: 'hash',
    web_push_keys: { p256dh: 'p256dh', auth: 'auth' },
    token: null,
    token_hash: null,
    device_name: 'Chrome on web',
    user_agent: 'UA',
    last_seen_at: new Date('2026-05-01T08:00:00.000Z'),
    revoked_at: null,
    failure_count: 0,
    last_failure_at: null,
    last_failure_reason: null,
    created_at: new Date('2026-05-01T08:00:00.000Z'),
    updated_at: new Date('2026-05-01T08:00:00.000Z'),
    ...overrides,
  };
}

describe('PushNotificationsService', () => {
  let subscriptions: ReturnType<typeof repo>;
  let deliveries: ReturnType<typeof repo>;
  let service: PushNotificationsService;
  const sendNotification = webpush.sendNotification as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions = repo();
    deliveries = repo();
    service = new PushNotificationsService(
      subscriptions as never,
      deliveries as never,
      config({
        WEB_PUSH_VAPID_PUBLIC_KEY: 'public-key',
        WEB_PUSH_VAPID_PRIVATE_KEY: 'private-key',
        WEB_PUSH_SUBJECT: 'mailto:support@getritora.com',
      }) as never,
    );
    sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  it('upserts a web push subscription without exposing raw endpoints or secret keys', async () => {
    const result = await service.upsertSubscription(
      'user-1',
      {
        provider: 'web_push',
        platform: 'web',
        endpoint: 'https://push.example/sub-1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
        device_name: 'Chrome on web',
      },
      'UA',
    );

    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        provider: 'web_push',
        platform: 'web',
        endpoint: 'https://push.example/sub-1',
        endpoint_hash: expect.any(String),
        web_push_keys: { p256dh: 'p256dh', auth: 'auth' },
        user_agent: 'UA',
        revoked_at: null,
      }),
    );
    expect(result).toMatchObject({
      provider: 'web_push',
      platform: 'web',
      endpoint_hash: expect.any(String),
    });
    expect(result).not.toHaveProperty('endpoint');
    expect(result).not.toHaveProperty('user_agent');
    expect(result).not.toHaveProperty('keys');
  });

  it('trims web push secrets and limits stored user-agent metadata', async () => {
    await service.upsertSubscription(
      'user-1',
      {
        provider: 'web_push',
        platform: 'web',
        endpoint: '  https://push.example/sub-1  ',
        keys: { p256dh: '  p256dh  ', auth: '  auth  ' },
        device_name: '  Chrome on web  ',
      },
      '  '.concat('U'.repeat(600), '  '),
    );

    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://push.example/sub-1',
        web_push_keys: { p256dh: 'p256dh', auth: 'auth' },
        device_name: 'Chrome on web',
        user_agent: 'U'.repeat(512),
      }),
    );
  });

  it('rejects the public key endpoint when VAPID config is incomplete', () => {
    const unconfiguredService = new PushNotificationsService(
      subscriptions as never,
      deliveries as never,
      config({
        WEB_PUSH_VAPID_PUBLIC_KEY: 'public-key',
        WEB_PUSH_VAPID_PRIVATE_KEY: '',
        WEB_PUSH_SUBJECT: 'mailto:support@getritora.com',
      }) as never,
    );

    expect(() => unconfiguredService.getPublicKey()).toThrow(
      'Browser push is not configured on this server.',
    );
  });

  it('summarizes active push health without exposing secrets', async () => {
    subscriptions.find.mockResolvedValue([
      webSubscription({ failure_count: 2 }),
      webSubscription({
        id: 'mobile-sub',
        provider: PushProviderValue.Fcm,
        platform: PushPlatformValue.Android,
        endpoint: null,
        web_push_keys: null,
        token: 'token',
        token_hash: 'token-hash',
      }),
    ]);
    deliveries.find.mockResolvedValue([
      {
        status: PushDeliveryStatusValue.Sent,
        attempt_count: 1,
        max_attempts: 3,
        next_attempt_at: null,
        locked_at: null,
      },
      {
        status: PushDeliveryStatusValue.Failed,
        attempt_count: 1,
        max_attempts: 3,
        next_attempt_at: new Date('2026-05-01T08:10:00.000Z'),
        locked_at: null,
      },
    ]);
    deliveries.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const result = await service.getStatus('user-1');

    expect(result).toMatchObject({
      active_subscriptions: 2,
      web_push_subscriptions: 1,
      mobile_subscriptions: 1,
      failing_subscriptions: 1,
      pending_retries: 4,
      exhausted_failures: 2,
      stale_sending: 1,
      recent_delivery_statuses: {
        sent: 1,
        failed: 1,
      },
    });
  });

  it('accepts future mobile push token records', async () => {
    await service.upsertSubscription(
      'user-1',
      {
        provider: 'fcm',
        platform: 'android',
        token: 'mobile-token',
        device_name: 'Android phone',
      },
      'Ritora Mobile',
    );

    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'fcm',
        platform: 'android',
        token: 'mobile-token',
        token_hash: expect.any(String),
        endpoint: null,
      }),
    );

    await service.upsertSubscription(
      'user-1',
      {
        provider: 'fcm',
        platform: 'ios',
        token: 'ios-mobile-token',
        device_name: 'iPhone',
      },
      'Ritora Mobile',
    );

    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'fcm',
        platform: 'ios',
        token: 'ios-mobile-token',
        token_hash: expect.any(String),
      }),
    );
  });

  it('rejects invalid provider/platform combinations', async () => {
    await expect(
      service.upsertSubscription('user-1', {
        provider: 'web_push',
        platform: 'ios',
        endpoint: 'https://push.example/sub-1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
    ).rejects.toThrow('Web push subscriptions must use the web platform.');

    await expect(
      service.upsertSubscription('user-1', {
        provider: 'fcm',
        platform: 'web',
        token: 'token',
      }),
    ).rejects.toThrow('FCM subscriptions must use an iOS or Android platform.');

    await expect(
      service.upsertSubscription('user-1', {
        provider: 'apns',
        platform: 'android',
        token: 'token',
      }),
    ).rejects.toThrow('APNs subscriptions must use the iOS platform.');
  });

  it('uses clear validation messages for malformed subscriptions', async () => {
    await expect(
      service.upsertSubscription('user-1', {
        provider: 'web_push',
        platform: 'web',
        endpoint: 'https://push.example/sub-1',
      }),
    ).rejects.toThrow(
      'Web push subscriptions require an endpoint, p256dh key, and auth key.',
    );

    await expect(
      service.upsertSubscription('user-1', {
        provider: 'fcm',
        platform: 'android',
      }),
    ).rejects.toThrow('Mobile push subscriptions require a device token.');
  });

  it('rejects unsafe web push endpoints before they can be used for outbound delivery', async () => {
    const unsafeEndpoints = [
      'http://push.example/sub-1',
      'https://localhost/sub-1',
      'https://127.0.0.1/sub-1',
      'https://push.example/sub-1#fragment',
      'https://push-service/sub-1',
    ];

    for (const endpoint of unsafeEndpoints) {
      await expect(
        service.upsertSubscription('user-1', {
          provider: 'web_push',
          platform: 'web',
          endpoint,
          keys: { p256dh: 'p256dh', auth: 'auth' },
        }),
      ).rejects.toThrow(
        'Web push endpoint must be a valid HTTPS push service URL.',
      );
    }
  });

  it('caps active push subscriptions per user', async () => {
    subscriptions.count.mockResolvedValue(20);

    await expect(
      service.upsertSubscription('user-1', {
        provider: 'web_push',
        platform: 'web',
        endpoint: 'https://push.example/sub-1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
    ).rejects.toThrow(
      'Too many push subscriptions. Remove an old device before adding another.',
    );
  });

  it('allows an existing active subscription to refresh when the user is at the device limit', async () => {
    subscriptions.findOne.mockResolvedValue(webSubscription());
    subscriptions.count.mockResolvedValue(20);

    await service.upsertSubscription('user-1', {
      provider: 'web_push',
      platform: 'web',
      endpoint: 'https://push.example/sub-1',
      keys: { p256dh: 'p256dh', auth: 'auth' },
    });

    expect(subscriptions.count).not.toHaveBeenCalled();
    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1', user_id: 'user-1' }),
    );
  });

  it('sends localized web push and records a deduped delivery', async () => {
    subscriptions.find.mockResolvedValue([webSubscription()]);

    await service.sendNotificationPush({
      userId: 'user-1',
      kind: 'product_nearing_expiry',
      titleKey: 'notificationsPage.kinds.product_nearing_expiry.title',
      bodyKey: 'notificationsPage.kinds.product_nearing_expiry.body',
      payload: {
        productName: 'CeraVe Retinol Serum',
        expiresAt: '2026-05-10T00:00:00.000Z',
        daysUntilExpiry: 1,
      },
      deepLink: '/shelf/product-1',
      dedupeKey: 'product_nearing_expiry:product-1:2026-05-10',
      language: 'en',
    });

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://push.example/sub-1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
      expect.stringContaining('expires in 1 day'),
      {
        TTL: 86400,
        timeout: 10000,
        urgency: 'normal',
      },
    );
    expect(deliveries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PushDeliveryStatusValue.Sent,
        dedupe_key: 'product_nearing_expiry:product-1:2026-05-10',
      }),
    );
  });

  it('renders English push copy for English speakers on a generic kind', async () => {
    subscriptions.find.mockResolvedValue([webSubscription()]);

    await service.sendNotificationPush({
      userId: 'user-1',
      kind: 'reaction_detected',
      titleKey: 'notificationsPage.kinds.reaction_detected.title',
      bodyKey: 'notificationsPage.kinds.reaction_detected.body',
      deepLink: '/today',
      language: 'en',
    });

    const sentBody = sendNotification.mock.calls[0]?.[1] as string;
    expect(sentBody).toContain('"title":"We paused your routine"');
    expect(sentBody).toContain(
      '"body":"Your photo today shows changes. Switched to barrier mode while your skin settles."',
    );
  });

  it('renders Swedish push copy for Swedish speakers on a generic kind', async () => {
    subscriptions.find.mockResolvedValue([webSubscription()]);

    await service.sendNotificationPush({
      userId: 'user-1',
      kind: 'reaction_detected',
      titleKey: 'notificationsPage.kinds.reaction_detected.title',
      bodyKey: 'notificationsPage.kinds.reaction_detected.body',
      deepLink: '/today',
      language: 'sv',
    });

    const sentBody = sendNotification.mock.calls[0]?.[1] as string;
    expect(sentBody).toContain('"title":"Vi pausade din rutin"');
    expect(sentBody).toContain('barriärläge');
  });

  it('renders Swedish product expiry copy when language is sv', async () => {
    subscriptions.find.mockResolvedValue([webSubscription()]);

    await service.sendNotificationPush({
      userId: 'user-1',
      kind: 'product_nearing_expiry',
      titleKey: 'notificationsPage.kinds.product_nearing_expiry.title',
      bodyKey: 'notificationsPage.kinds.product_nearing_expiry.body',
      payload: {
        productName: 'CeraVe Retinol Serum',
        expiresAt: '2026-05-10T00:00:00.000Z',
        daysUntilExpiry: 3,
      },
      deepLink: '/shelf/product-1',
      dedupeKey: 'product_nearing_expiry:product-1:2026-05-10',
      language: 'sv',
    });

    const sentBody = sendNotification.mock.calls[0]?.[1] as string;
    expect(sentBody).toContain('"title":"Produkt nära utgång"');
    expect(sentBody).toContain('går ut om 3 dagar');
  });

  it('falls back to English when language is missing or unsupported', async () => {
    subscriptions.find.mockResolvedValue([webSubscription()]);

    await service.sendNotificationPush({
      userId: 'user-1',
      kind: 'photo_reminder',
      titleKey: 'notificationsPage.kinds.photo_reminder.title',
      bodyKey: 'notificationsPage.kinds.photo_reminder.body',
      deepLink: '/journal/upload',
      language: null,
    });

    const sentBody = sendNotification.mock.calls[0]?.[1] as string;
    expect(sentBody).toContain('"title":"Time for today\'s photo"');
  });

  it('records a clear skipped reason when web push is unavailable', async () => {
    const unconfiguredService = new PushNotificationsService(
      subscriptions as never,
      deliveries as never,
      config({
        WEB_PUSH_VAPID_PUBLIC_KEY: '',
        WEB_PUSH_VAPID_PRIVATE_KEY: '',
        WEB_PUSH_SUBJECT: 'mailto:support@getritora.com',
      }) as never,
    );
    subscriptions.find.mockResolvedValue([webSubscription()]);

    await unconfiguredService.sendNotificationPush({
      userId: 'user-1',
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
      dedupeKey: 'suggestion_ready:slot-1',
    });

    expect(deliveries.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: PushDeliveryStatusValue.Skipped,
        error_message: 'Browser push is not configured on this server.',
      }),
    );
  });

  it('records transient failures with a retry schedule', async () => {
    subscriptions.find.mockResolvedValue([webSubscription()]);
    sendNotification.mockRejectedValue(
      Object.assign(new Error('Provider overloaded'), { statusCode: 503 }),
    );

    await service.sendNotificationPush({
      userId: 'user-1',
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
      dedupeKey: 'suggestion_ready:slot-1',
    });

    expect(deliveries.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: PushDeliveryStatusValue.Failed,
        provider_status_code: 503,
        error_message: 'Push service temporarily unavailable.',
        attempt_count: 1,
        next_attempt_at: expect.any(Date),
        locked_at: null,
      }),
    );
    expect(subscriptions.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        last_failure_reason: 'Push service temporarily unavailable.',
      }),
    );
  });

  it('retries a due failed dedupe delivery with the current payload', async () => {
    subscriptions.find.mockResolvedValue([webSubscription()]);
    deliveries.findOne.mockResolvedValue({
      id: 'delivery-1',
      user_id: 'user-1',
      subscription_id: 'sub-1',
      notification_id: null,
      kind: 'suggestion_ready',
      severity: 'info',
      dedupe_key: 'suggestion_ready:slot-1',
      status: PushDeliveryStatusValue.Failed,
      provider_status_code: 503,
      error_message: 'Provider overloaded',
      push_payload: null,
      attempt_count: 1,
      max_attempts: 3,
      last_attempt_at: new Date('2026-05-01T08:00:00.000Z'),
      next_attempt_at: new Date('2026-05-01T08:01:00.000Z'),
      locked_at: null,
      attempted_at: new Date('2026-05-01T08:00:00.000Z'),
      updated_at: new Date('2026-05-01T08:00:00.000Z'),
    });

    await service.sendNotificationPush({
      userId: 'user-1',
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
      dedupeKey: 'suggestion_ready:slot-1',
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(deliveries.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: PushDeliveryStatusValue.Sent,
        attempt_count: 2,
        next_attempt_at: null,
        locked_at: null,
      }),
    );
  });

  it('skips an already claimed dedupe key', async () => {
    subscriptions.find.mockResolvedValue([webSubscription()]);
    deliveries.findOne.mockResolvedValue({
      id: 'delivery-1',
      status: PushDeliveryStatusValue.Sent,
    });

    await service.sendNotificationPush({
      userId: 'user-1',
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
      dedupeKey: 'suggestion_ready:slot-1',
    });

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('revokes dead web push subscriptions on 404 or 410 responses', async () => {
    const subscription = webSubscription();
    subscriptions.find.mockResolvedValue([subscription]);
    sendNotification.mockRejectedValue(
      Object.assign(new Error('Gone'), { statusCode: 410 }),
    );

    await service.sendNotificationPush({
      userId: 'user-1',
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
      dedupeKey: 'suggestion_ready:slot-1',
    });

    expect(subscription.revoked_at).toBeInstanceOf(Date);
    expect(deliveries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PushDeliveryStatusValue.Failed,
        provider_status_code: 410,
        error_message: 'Push subscription expired.',
      }),
    );
  });

  it('requeues stale sending deliveries and retries due deliveries', async () => {
    const staleDelivery = {
      id: 'stale-delivery',
      user_id: 'user-1',
      status: PushDeliveryStatusValue.Sending,
      error_message: null,
      provider_status_code: null,
      attempt_count: 0,
      max_attempts: 3,
      locked_at: new Date('2026-05-01T07:45:00.000Z'),
      next_attempt_at: null,
    };
    const retryDelivery = {
      id: 'retry-delivery',
      user_id: 'user-1',
      subscription_id: 'sub-1',
      notification_id: null,
      kind: 'product_expired',
      severity: 'critical',
      dedupe_key: 'product_expired:product-1:2026-05-01',
      status: PushDeliveryStatusValue.Failed,
      provider_status_code: 503,
      error_message: 'Provider overloaded',
      push_payload: {
        title: 'Product expired',
        body: 'CeraVe expired on May 1, 2026.',
        data: {
          kind: 'product_expired',
          severity: 'critical',
          deepLink: '/shelf/product-1',
          notificationId: 'notification-1',
        },
      },
      attempt_count: 1,
      max_attempts: 3,
      last_attempt_at: new Date('2026-05-01T08:00:00.000Z'),
      next_attempt_at: new Date('2026-05-01T08:01:00.000Z'),
      locked_at: null,
      subscription: webSubscription(),
    };
    deliveries.find
      .mockResolvedValueOnce([staleDelivery])
      .mockResolvedValueOnce([retryDelivery]);

    const result = await service.runDeliveryMaintenance(
      new Date('2026-05-01T08:10:00.000Z'),
    );

    expect(result).toEqual({
      requeued: 1,
      retried: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    expect(staleDelivery).toMatchObject({
      status: PushDeliveryStatusValue.Failed,
      next_attempt_at: new Date('2026-05-01T08:10:00.000Z'),
      locked_at: null,
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});
