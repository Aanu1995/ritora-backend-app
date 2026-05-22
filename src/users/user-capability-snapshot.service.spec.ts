import { PlatformGlobalRestrictionCapability } from '../platform-controls/platform-global-restrictions';
import { PlatformGlobalRestrictionsService } from '../platform-controls/platform-global-restrictions.service';
import { User } from './entities/user.entity';
import { UserCapabilitySnapshotService } from './user-capability-snapshot.service';
import { UserRestrictionCapability } from './user-restrictions';

describe('UserCapabilitySnapshotService', () => {
  const platformRestrictions = {
    listActiveRestrictions: jest.fn(),
  } as unknown as jest.Mocked<PlatformGlobalRestrictionsService>;

  let service: UserCapabilitySnapshotService;

  beforeEach(() => {
    jest.clearAllMocks();
    platformRestrictions.listActiveRestrictions.mockResolvedValue([]);
    service = new UserCapabilitySnapshotService(platformRestrictions);
  });

  const user = (overrides: Partial<User> = {}): User =>
    ({
      id: '01TESTUSER',
      account_restricted_at: null,
      account_restriction_capabilities: null,
      account_restriction_expires_at: null,
      account_restriction_user_message: null,
      ...overrides,
    }) as User;

  it('returns enabled feature access when no user or platform restrictions are active', async () => {
    const snapshot = await service.buildForUser(user());

    expect(snapshot.aiGeneration.enabled).toBe(true);
    expect(snapshot.imageUpload.enabled).toBe(true);
    expect(snapshot.productExtraction.enabled).toBe(true);
    expect(snapshot.notifications.enabled).toBe(true);
    expect(snapshot.supportContact.enabled).toBe(true);
    expect(snapshot.accountCreation.enabled).toBe(true);
    expect(platformRestrictions.listActiveRestrictions).toHaveBeenCalledWith(
      expect.arrayContaining([
        PlatformGlobalRestrictionCapability.DisableAccountCreation,
        PlatformGlobalRestrictionCapability.DisableAiGeneration,
        PlatformGlobalRestrictionCapability.DisableImageUpload,
        PlatformGlobalRestrictionCapability.DisableProductExtraction,
        PlatformGlobalRestrictionCapability.DisableNotifications,
      ]),
    );
  });

  it('marks only matching user-restricted features as disabled without exposing admin reason fields', async () => {
    const snapshot = await service.buildForUser(
      user({
        account_restricted_at: new Date('2026-05-21T10:00:00.000Z'),
        account_restriction_capabilities: [
          UserRestrictionCapability.DisableAiGeneration,
          UserRestrictionCapability.DisableSupportContact,
        ],
        account_restriction_expires_at: new Date('2026-05-22T10:00:00.000Z'),
        account_restriction_reason: 'Internal fraud signal',
        account_restriction_internal_note: 'Never expose this',
        account_restriction_user_message: 'Your account is being reviewed.',
      }),
      new Date('2026-05-21T12:00:00.000Z'),
    );

    expect(snapshot.aiGeneration).toEqual({
      enabled: false,
      blockedBy: 'user_restriction',
      expiresAt: '2026-05-22T10:00:00.000Z',
      message: 'Your account is being reviewed.',
    });
    expect(snapshot.supportContact.enabled).toBe(false);
    expect(snapshot.imageUpload.enabled).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('Internal fraud signal');
    expect(JSON.stringify(snapshot)).not.toContain('Never expose this');
  });

  it('marks platform-disabled features with generic platform source metadata', async () => {
    platformRestrictions.listActiveRestrictions.mockResolvedValue([
      {
        capability: PlatformGlobalRestrictionCapability.DisableImageUpload,
        expiresAt: new Date('2026-05-21T13:00:00.000Z'),
      },
      {
        capability:
          PlatformGlobalRestrictionCapability.DisableProductExtraction,
        expiresAt: null,
      },
    ]);

    const snapshot = await service.buildForUser(user());

    expect(snapshot.imageUpload).toEqual({
      enabled: false,
      blockedBy: 'platform_global_restriction',
      expiresAt: '2026-05-21T13:00:00.000Z',
      message: null,
    });
    expect(snapshot.productExtraction).toEqual({
      enabled: false,
      blockedBy: 'platform_global_restriction',
      expiresAt: null,
      message: null,
    });
    expect(snapshot.aiGeneration.enabled).toBe(true);
  });
});
