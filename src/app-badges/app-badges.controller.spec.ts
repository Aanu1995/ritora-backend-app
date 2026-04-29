import { AppBadgesController } from './app-badges.controller';
import { AppBadgesService } from './app-badges.service';

describe('AppBadgesController', () => {
  const service = {
    getNavBadges: jest.fn(),
  } as unknown as jest.Mocked<AppBadgesService>;

  let controller: AppBadgesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AppBadgesController(service);
  });

  it('returns nav badges for the current user', async () => {
    service.getNavBadges.mockResolvedValue({
      notifications_unread_count: 3,
      skin_journal_warning_count: 1,
    });

    await expect(controller.getNavBadges('user-1')).resolves.toEqual({
      notifications_unread_count: 3,
      skin_journal_warning_count: 1,
    });
    expect(service.getNavBadges).toHaveBeenCalledWith('user-1');
  });
});
