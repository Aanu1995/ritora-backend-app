import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PlatformGlobalRestrictionsService } from '../platform-controls/platform-global-restrictions.service';
import { PlatformGlobalRestrictionCapability } from '../platform-controls/platform-global-restrictions';
import { UserRestrictionEnforcementService } from './user-restriction-enforcement.service';
import {
  type RestrictableUser,
  UserRestrictionCapability,
} from './user-restrictions';

const USER_RESTRICTION_ALLOWED_CAPABILITIES_KEY =
  'userRestrictionAllowedCapabilities';

type RequestWithUser = Request & {
  user?: RestrictableUser & {
    id?: unknown;
  };
};

export const RequireUnrestrictedUserCapabilities = (
  ...capabilities: UserRestrictionCapability[]
) => SetMetadata(USER_RESTRICTION_ALLOWED_CAPABILITIES_KEY, capabilities);

@Injectable()
export class UserRestrictionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly restrictions: UserRestrictionEnforcementService,
    private readonly platformRestrictions: PlatformGlobalRestrictionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capabilities = this.reflector.getAllAndOverride<
      UserRestrictionCapability[]
    >(USER_RESTRICTION_ALLOWED_CAPABILITIES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!capabilities || capabilities.length === 0) {
      return true;
    }

    await this.platformRestrictions.assertAllAllowed(
      mapUserRestrictionsToPlatformRestrictions(capabilities),
    );

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const userId = request.user?.id;
    if (typeof userId !== 'string') {
      return false;
    }

    if (hasRestrictionSnapshot(request.user)) {
      this.restrictions.assertAllAllowedForUser(request.user, capabilities);
      return true;
    }

    await this.restrictions.assertAllAllowed(userId, capabilities);
    return true;
  }
}

function mapUserRestrictionsToPlatformRestrictions(
  capabilities: readonly UserRestrictionCapability[],
): PlatformGlobalRestrictionCapability[] {
  const mapped: PlatformGlobalRestrictionCapability[] = [];
  for (const capability of capabilities) {
    const platformCapability = toPlatformRestrictionCapability(capability);
    if (platformCapability && !mapped.includes(platformCapability)) {
      mapped.push(platformCapability);
    }
  }

  return mapped;
}

function toPlatformRestrictionCapability(
  capability: UserRestrictionCapability,
): PlatformGlobalRestrictionCapability | null {
  switch (capability) {
    case UserRestrictionCapability.DisableAiGeneration:
      return PlatformGlobalRestrictionCapability.DisableAiGeneration;
    case UserRestrictionCapability.DisableImageUpload:
      return PlatformGlobalRestrictionCapability.DisableImageUpload;
    case UserRestrictionCapability.DisableProductExtraction:
      return PlatformGlobalRestrictionCapability.DisableProductExtraction;
    case UserRestrictionCapability.DisableNotifications:
      return PlatformGlobalRestrictionCapability.DisableNotifications;
    default:
      return null;
  }
}

function hasRestrictionSnapshot(
  user: RequestWithUser['user'],
): user is RestrictableUser & { id?: unknown } {
  return Boolean(
    user &&
    'account_restricted_at' in user &&
    'account_restriction_capabilities' in user &&
    'account_restriction_expires_at' in user,
  );
}
