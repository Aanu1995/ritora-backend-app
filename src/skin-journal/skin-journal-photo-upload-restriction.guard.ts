import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PlatformGlobalRestrictionCapability } from '../platform-controls/platform-global-restrictions';
import { PlatformGlobalRestrictionsService } from '../platform-controls/platform-global-restrictions.service';
import { UserRestrictionEnforcementService } from '../users/user-restriction-enforcement.service';
import {
  type RestrictableUser,
  UserRestrictionCapability,
} from '../users/user-restrictions';

const USER_PHOTO_UPLOAD_CAPABILITIES: readonly UserRestrictionCapability[] = [
  UserRestrictionCapability.DisableImageUpload,
  UserRestrictionCapability.DisableAiGeneration,
];

const PLATFORM_PHOTO_UPLOAD_CAPABILITIES: readonly PlatformGlobalRestrictionCapability[] =
  [
    PlatformGlobalRestrictionCapability.DisableImageUpload,
    PlatformGlobalRestrictionCapability.DisableAiGeneration,
  ];

type RequestWithUser = Request & {
  user?: RestrictableUser & {
    id?: unknown;
  };
};

@Injectable()
export class SkinJournalPhotoUploadRestrictionGuard implements CanActivate {
  constructor(
    private readonly restrictions: UserRestrictionEnforcementService,
    private readonly platformRestrictions: PlatformGlobalRestrictionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!isMultipartFormRequest(request)) {
      return true;
    }

    const userId = request.user?.id;
    if (typeof userId !== 'string') {
      return false;
    }

    await this.platformRestrictions.assertAllAllowed(
      PLATFORM_PHOTO_UPLOAD_CAPABILITIES,
    );

    if (hasRestrictionSnapshot(request.user)) {
      this.restrictions.assertAllAllowedForUser(
        request.user,
        USER_PHOTO_UPLOAD_CAPABILITIES,
      );
      return true;
    }

    await this.restrictions.assertAllAllowed(
      userId,
      USER_PHOTO_UPLOAD_CAPABILITIES,
    );
    return true;
  }
}

function isMultipartFormRequest(request: Request): boolean {
  const contentType = request.get('content-type');

  return (
    typeof contentType === 'string' &&
    contentType.toLowerCase().includes('multipart/form-data')
  );
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
