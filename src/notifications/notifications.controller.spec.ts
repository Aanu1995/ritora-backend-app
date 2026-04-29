import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  const service = {
    list: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
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
});
