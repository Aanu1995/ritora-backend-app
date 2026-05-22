import { createDefaultUserCapabilities } from '../users/dto/user-capabilities.dto';
import { UserCapabilitySnapshotService } from '../users/user-capability-snapshot.service';
import { AppBadgesController } from './app-badges.controller';
import { AppBadgesService } from './app-badges.service';

describe('AppBadgesController', () => {
  const service = {
    getNavBadges: jest.fn(),
  } as unknown as jest.Mocked<AppBadgesService>;
  const capabilitySnapshot = {
    buildPublicPlatformCapabilities: jest.fn(),
  } as unknown as jest.Mocked<UserCapabilitySnapshotService>;

  let controller: AppBadgesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AppBadgesController(service, capabilitySnapshot);
  });

  it('returns public platform capabilities without requiring a user', async () => {
    const capabilities = createDefaultUserCapabilities();
    capabilitySnapshot.buildPublicPlatformCapabilities.mockResolvedValue(
      capabilities,
    );

    await expect(controller.getCapabilities()).resolves.toEqual(capabilities);
    expect(
      capabilitySnapshot.buildPublicPlatformCapabilities,
    ).toHaveBeenCalledTimes(1);
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
