import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  const service = {
    list: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
    getPushPublicKey: jest.fn(),
    listPushSubscriptions: jest.fn(),
    getPushStatus: jest.fn(),
    upsertPushSubscription: jest.fn(),
    revokePushSubscription: jest.fn(),
  } as unknown as jest.Mocked<NotificationsService>;

  let controller: NotificationsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new NotificationsController(service);
  });

  it('passes validated pagination params to the notification list service', async () => {
    service.list.mockResolvedValue({
      items: [],
      nextCursor: null,
      unread_count: 0,
    });

    await controller.list('user-1', {
      limit: 25,
      cursor: 'cursor-1',
    });

    expect(service.list).toHaveBeenCalledWith('user-1', {
      limit: 25,
      cursor: 'cursor-1',
    });
  });

  it('passes push subscription requests to the notification service', async () => {
    service.getPushPublicKey.mockReturnValue({ publicKey: 'public-key' });
    service.listPushSubscriptions.mockResolvedValue([]);
    service.getPushStatus.mockResolvedValue({
      active_subscriptions: 0,
      web_push_subscriptions: 0,
      mobile_subscriptions: 0,
      failing_subscriptions: 0,
      recent_delivery_statuses: {
        sending: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
      },
      pending_retries: 0,
      exhausted_failures: 0,
      stale_sending: 0,
    });
    service.upsertPushSubscription.mockResolvedValue({
      id: 'sub-1',
      provider: 'web_push',
      platform: 'web',
      endpoint_hash: 'hash',
      last_seen_at: '2026-05-01T08:00:00.000Z',
      created_at: '2026-05-01T08:00:00.000Z',
      failure_count: 0,
      last_failure_at: null,
    });

    expect(controller.getPushPublicKey()).toEqual({
      publicKey: 'public-key',
    });
    await controller.listPushSubscriptions('user-1');
    await controller.getPushStatus('user-1');
    await controller.upsertPushSubscription(
      'user-1',
      {
        provider: 'web_push',
        platform: 'web',
        endpoint: 'https://push.example/sub-1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      },
      'UA',
    );
    await controller.revokePushSubscription('user-1', 'sub-1');

    expect(service.listPushSubscriptions).toHaveBeenCalledWith('user-1');
    expect(service.getPushStatus).toHaveBeenCalledWith('user-1');
    expect(service.upsertPushSubscription).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ provider: 'web_push' }),
      'UA',
    );
    expect(service.revokePushSubscription).toHaveBeenCalledWith(
      'user-1',
      'sub-1',
    );
  });
});
