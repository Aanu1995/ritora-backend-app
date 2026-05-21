import { ForbiddenException } from '@nestjs/common';
import { User } from './entities/user.entity';
import { UserRestrictionEnforcementService } from './user-restriction-enforcement.service';
import { UserRestrictionCapability } from './user-restrictions';
import { UsersService } from './users.service';

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    account_restricted_at: null,
    account_restriction_capabilities: null,
    account_restriction_expires_at: null,
    id: '01USER',
    ...overrides,
  } as User;
}

describe('UserRestrictionEnforcementService', () => {
  it('blocks an action when the matching restriction capability is active', async () => {
    const usersService = {
      clearExpiredAccountRestriction: jest.fn(),
      findById: jest.fn(async () =>
        fakeUser({
          account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
          account_restriction_capabilities: [
            UserRestrictionCapability.DisableAiGeneration,
          ],
        }),
      ),
    } as unknown as UsersService;
    const service = new UserRestrictionEnforcementService(usersService);

    await expect(
      service.assertAllowed(
        '01USER',
        UserRestrictionCapability.DisableAiGeneration,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows an action when only another capability is restricted', async () => {
    const usersService = {
      clearExpiredAccountRestriction: jest.fn(),
      findById: jest.fn(async () =>
        fakeUser({
          account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
          account_restriction_capabilities: [
            UserRestrictionCapability.DisableNotifications,
          ],
        }),
      ),
    } as unknown as UsersService;
    const service = new UserRestrictionEnforcementService(usersService);

    await expect(
      service.assertAllowed(
        '01USER',
        UserRestrictionCapability.DisableAiGeneration,
      ),
    ).resolves.toBeUndefined();
  });

  it('can enforce against an already loaded restriction snapshot without another user lookup', () => {
    const usersService = {
      clearExpiredAccountRestriction: jest.fn(),
      findById: jest.fn(),
    } as unknown as UsersService;
    const service = new UserRestrictionEnforcementService(usersService);

    expect(() =>
      service.assertAllAllowedForUser(
        fakeUser({
          account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
          account_restriction_capabilities: [
            UserRestrictionCapability.DisableNotifications,
          ],
        }),
        [UserRestrictionCapability.DisableAiGeneration],
      ),
    ).not.toThrow();
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('soft-clears expired restrictions before enforcing a loaded user action', async () => {
    const usersService = {
      clearExpiredAccountRestriction: jest.fn(async () => true),
      findById: jest.fn(async () =>
        fakeUser({
          account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
          account_restriction_capabilities: [
            UserRestrictionCapability.DisableAiGeneration,
          ],
          account_restriction_expires_at: new Date('2026-05-20T10:00:00.000Z'),
        }),
      ),
    } as unknown as UsersService;
    const service = new UserRestrictionEnforcementService(usersService);

    await expect(
      service.assertAllowed(
        '01USER',
        UserRestrictionCapability.DisableAiGeneration,
      ),
    ).resolves.toBeUndefined();
    expect(usersService.clearExpiredAccountRestriction).toHaveBeenCalledWith(
      '01USER',
    );
  });
});
