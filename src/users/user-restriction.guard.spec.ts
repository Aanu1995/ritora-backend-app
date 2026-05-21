import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformGlobalRestrictionsService } from '../platform-controls/platform-global-restrictions.service';
import { PlatformGlobalRestrictionCapability } from '../platform-controls/platform-global-restrictions';
import { UserRestrictionEnforcementService } from './user-restriction-enforcement.service';
import {
  RequireUnrestrictedUserCapabilities,
  UserRestrictionGuard,
} from './user-restriction.guard';
import { UserRestrictionCapability } from './user-restrictions';

function contextWithUser(user: unknown): ExecutionContext {
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('UserRestrictionGuard', () => {
  it('checks mapped platform restrictions before per-user restriction state', async () => {
    class TestController {
      @RequireUnrestrictedUserCapabilities(
        UserRestrictionCapability.DisableAiGeneration,
        UserRestrictionCapability.DisableImageUpload,
      )
      handle() {
        return undefined;
      }
    }
    const handler = Object.getOwnPropertyDescriptor(
      TestController.prototype,
      'handle',
    )?.value as () => void;
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([
          UserRestrictionCapability.DisableAiGeneration,
          UserRestrictionCapability.DisableImageUpload,
        ]),
    } as unknown as Reflector;
    const restrictions = {
      assertAllAllowedForUser: jest.fn(),
    } as unknown as UserRestrictionEnforcementService;
    const platformRestrictions = {
      assertAllAllowed: jest.fn().mockResolvedValue(undefined),
    } as unknown as PlatformGlobalRestrictionsService;
    const guard = new UserRestrictionGuard(
      reflector,
      restrictions,
      platformRestrictions,
    );

    await expect(
      guard.canActivate({
        ...contextWithUser({
          id: 'user-1',
          account_restricted_at: null,
          account_restriction_capabilities: null,
          account_restriction_expires_at: null,
        }),
        getHandler: () => handler,
      }),
    ).resolves.toBe(true);

    expect(platformRestrictions.assertAllAllowed).toHaveBeenCalledWith([
      PlatformGlobalRestrictionCapability.DisableAiGeneration,
      PlatformGlobalRestrictionCapability.DisableImageUpload,
    ]);
    expect(restrictions.assertAllAllowedForUser).toHaveBeenCalled();
  });
});
